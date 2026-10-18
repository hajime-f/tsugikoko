import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { database } from "../../src/server/firebase/admin";
import { claimDispatch, createPlace, listPlaces, listVisits, processExtraction, updatePlace, updateVisit } from "../../src/server/places/service";
import { extractionTarget, type PageFetcher } from "../../src/server/extraction/sources";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko") throw new Error("Local demo emulator required");
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const sourceHash = (url: string) => createHash("sha256").update(url).digest("hex");
// robots.txtは404（制限なし）とし、指定したページだけを返す。未指定のURLへは接続しない。
function mockPages(pages: Record<string, string>): PageFetcher {
  return async url => {
    if (url.endsWith("/robots.txt")) return { status: 404, contentType: "text/plain", body: "" };
    const body = pages[url];
    if (body === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return { status: 200, contentType: "text/html; charset=utf-8", body };
  };
}
const jsonLd = (name: string, address: string) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name, address })}</script>`;

test("保存済みの取得結果を再利用し、本人の編集を保持する", async () => {
  const url = "https://cache.example.com/shop", source = extractionTarget(url)!;
  const cacheRef = database().doc(`placeSources/${sourceHash(url)}`);
  const uid = "cache-json-ld";
  await cacheRef.set({ name: "確認用カフェ", address: "東京都渋谷区恵比寿1-2-3", genre: null, fetchedAt: Date.now(), provenance: { ...source, method: "json-ld-v1" } });
  const { place } = await createPlace(uid, url);
  const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
  await ref.update({ name: "自分用の店名", note: "メモ", editedFields: ["name"], customDetails: true });
  await processExtraction(uid, place.id, { fetcher: mockPages({}) });
  const result = await ref.get();
  assert.equal(result.get("extraction"), "ready");
  assert.equal(result.get("name"), "自分用の店名");
  assert.equal(result.get("address"), "東京都渋谷区恵比寿1-2-3");
  assert.equal(result.get("note"), "メモ");
});

test("JSON-LDがあれば自動入力し、なければURLとメモを残して手入力に切り替える", async () => {
  const url = "https://pipeline.example.com/shop";
  const cacheRef = database().doc(`placeSources/${sourceHash(url)}`);
  for (const hasJsonLd of [true, false]) {
    await cacheRef.delete();
    const uid = `pipeline-${hasJsonLd}`, { place } = await createPlace(uid, url);
    const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
    await ref.update({ note: "残すメモ" });
    const html = hasJsonLd ? jsonLd("JSON-LDカフェ", "東京都渋谷区恵比寿1-2-3") : "<title>確認用カフェ</title><p>150-0000 東京都渋谷区恵比寿1-2-3</p>";
    await processExtraction(uid, place.id, { fetcher: mockPages({ [url]: html }) });
    const result = await ref.get();
    assert.equal(result.get("url"), url);
    assert.equal(result.get("note"), "残すメモ");
    assert.equal(result.get("name"), hasJsonLd ? "JSON-LDカフェ" : "");
    assert.equal(result.get("extraction"), hasJsonLd ? "ready" : "needs_review");
    assert.equal(result.get("reason"), hasJsonLd ? null : "not_found");
  }
});

test("除外サイトは取得せず、その場で手入力待ちとして保存する", async () => {
  for (const url of ["https://tabelog.com/tokyo/A1303/A130302/13323066/", "https://restaurant.ikyu.com/148322", "https://www.instagram.com/p/example/"]) {
    const { place } = await createPlace("excluded-sites", url);
    assert.equal(place.extraction, "needs_review", url);
    assert.equal(place.reason, "unsupported");
    assert.equal(place.name, "");
  }
  const { place } = await createPlace("official-site", "https://official.example.com/");
  assert.equal(place.extraction, "pending");
});

test("異なるURLの同じ店舗は、メモと本人の修正を引き継いで1件にまとめる", async () => {
  const uid = "merge-note", urlA = "https://merge-a.example.com/shop", urlB = "https://merge-b.example.com/shop";
  for (const url of [urlA, urlB]) await database().doc(`placeSources/${sourceHash(url)}`).delete();
  const fetcher = mockPages({ [urlA]: jsonLd("統合カフェ", "東京都渋谷区恵比寿1-2-3"), [urlB]: jsonLd("統合カフェ", "東京都渋谷区恵比寿1-2-3") });
  const first = (await createPlace(uid, urlA)).place;
  await processExtraction(uid, first.id, { fetcher });
  await updatePlace(uid, first.id, { name: "統合カフェ", address: "東京都渋谷区恵比寿1-2-3", note: "最初のメモ" });
  const second = (await createPlace(uid, urlB)).place;
  await updatePlace(uid, second.id, { name: "", address: "", note: "あとのメモ" });
  await updateVisit(uid, first.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-02-29", rating: 4, comment: "最初の訪問" });
  await updateVisit(uid, second.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: 5, comment: "再訪の感想" });
  await processExtraction(uid, second.id, { fetcher });
  assert.equal((await database().doc(`users/${uid}/savedPlaces/${second.id}`).get()).exists, false);
  const merged = await database().doc(`users/${uid}/savedPlaces/${first.id}`).get();
  assert.equal(merged.get("note"), "最初のメモ\n\nあとのメモ");
  assert.deepEqual(merged.get("sourceUrls"), [urlA, urlB]);
  assert.equal(merged.get("name"), "統合カフェ");
  assert.equal(merged.get("visitCount"), 2);
  assert.equal(merged.get("latestVisit.rating"), 5);
  assert.deepEqual((await listVisits(uid, first.id, null)).visits.map(visit => visit.comment), ["再訪の感想", "最初の訪問"]);
  assert.equal((await createPlace(uid, urlB)).place.id, first.id);
});

test("本人の再取得は元ページを読み直し、通常の取得は保存済みの結果を使う", async () => {
  const uid = "refresh", url = "https://refresh.example.com/shop";
  const cacheRef = database().doc(`placeSources/${sourceHash(url)}`);
  const source = extractionTarget(url);
  await cacheRef.set({ name: "古い店名", address: "東京都渋谷区恵比寿1-2-3", genre: null, fetchedAt: Date.now() - 60 * 60_000, provenance: { ...source, method: "json-ld-v1" } });
  const fetcher = mockPages({ [url]: jsonLd("新しい店名", "東京都渋谷区恵比寿1-2-3") });
  const { place } = await createPlace(uid, url);
  const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
  await processExtraction(uid, place.id, { fetcher });
  assert.equal((await ref.get()).get("name"), "古い店名");
  await ref.update({ lastAttemptAt: Date.now() - 120_000 });
  await updatePlace(uid, place.id, { action: "retry" });
  await processExtraction(uid, place.id, { fetcher });
  const result = await ref.get();
  assert.equal(result.get("name"), "新しい店名");
  assert.equal(result.get("refresh"), false);
});

test("取得ジョブは1回だけ登録し、処理中の記録は再試行を求める", async () => {
  const uid = "dispatch", url = "https://dispatch.example.com/shop";
  const { place } = await createPlace(uid, url);
  assert.equal(await claimDispatch(uid, place.id), true);
  assert.equal(await claimDispatch(uid, place.id), false);
  const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
  await ref.update({ lastAttemptAt: Date.now() });
  assert.equal(await processExtraction(uid, place.id), "busy");
  await ref.update({ lastAttemptAt: Date.now() - 120_000, queuedAt: Date.now() - 11 * 60_000 });
  assert.equal(await claimDispatch(uid, place.id), true);
});

test("並行する訪問の追加と再送でも重複せず、過去日の追加・編集・削除で直近の評価を更新する", async () => {
  const uid = `visits-${randomUUID()}`, { place } = await createPlace(uid, "https://example.com/visits");
  const visitId = randomUUID();
  const input = { action: "addVisit" as const, visitId, visitedOn: "2024-03-01", rating: 5, comment: "最新の感想" };
  const results = await Promise.all([updateVisit(uid, place.id, input), updateVisit(uid, place.id, input)]);
  assert.ok(results.every(place => place.visitCount === 1));
  const olderId = randomUUID();
  let updated = await updateVisit(uid, place.id, { ...input, visitId: olderId, visitedOn: "2024-02-29", rating: null, comment: "未評価の訪問" });
  assert.equal(updated.visitCount, 2); assert.equal(updated.latestVisit?.rating, 5);
  const history = (await listVisits(uid, place.id, null)).visits;
  updated = await updateVisit(uid, place.id, { action: "editVisit", visitId, visitedOn: "2024-02-28", rating: 3, comment: "日付を訂正", updatedAt: history[0].updatedAt });
  assert.equal(updated.latestVisit?.id, olderId); assert.equal(updated.latestVisit?.rating, null);
  await assert.rejects(updateVisit(uid, place.id, { action: "deleteVisit", visitId, updatedAt: history[0].updatedAt }), /別の画面/);
  const corrected = (await listVisits(uid, place.id, null)).visits.find(visit => visit.id === visitId)!;
  await updateVisit(uid, place.id, { action: "deleteVisit", visitId, updatedAt: corrected.updatedAt });
  await updateVisit(uid, place.id, { action: "deleteVisit", visitId, updatedAt: corrected.updatedAt });
  updated = await updateVisit(uid, place.id, { action: "deleteVisit", visitId: olderId, updatedAt: history[1].updatedAt });
  assert.equal(updated.visitCount, 0); assert.equal(updated.latestVisit, null);
  assert.equal((await listPlaces(uid, false, null, "saved")).places.length, 1);
  assert.equal((await listPlaces(uid, false, null, "visited")).places.length, 0);
});

test("訪問履歴は10件ずつ取得し、ごみ箱の復元で保持、期限切れ後は非表示・再登録時に消去する", async () => {
  const uid = `history-${randomUUID()}`, url = "https://example.com/history", { place } = await createPlace(uid, url);
  const visits = Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), visitedOn: "2024-03-01", rating: 4, comment: "感想", createdAt: index, updatedAt: index }));
  const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
  await ref.update({ visits, visitCount: 100, latestVisit: { id: visits[99].id, visitedOn: "2024-03-01", rating: 4 } });
  const first = await listVisits(uid, place.id, null), second = await listVisits(uid, place.id, first.nextCursor);
  assert.equal(first.visits.length, 10); assert.equal(second.visits.length, 10);
  assert.equal(new Set([...first.visits, ...second.visits].map(visit => visit.id)).size, 20);
  await assert.rejects(updateVisit(uid, place.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: null, comment: "" }), /100回/);
  await updatePlace(uid, place.id, { action: "trash" });
  assert.equal((await listVisits(uid, place.id, null)).visits.length, 10);
  await assert.rejects(updateVisit(uid, place.id, { action: "deleteVisit", visitId: visits[0].id, updatedAt: 0 }), /ごみ箱/);
  await updatePlace(uid, place.id, { action: "restore" });
  assert.equal((await listPlaces(uid, false, null, "visited")).places[0].visitCount, 100);
  assert.equal("visits" in (await listPlaces(uid, false, null)).places[0], false);
  await ref.update({ deleted: true, deleteAt: Date.now() - 1 });
  await assert.rejects(listVisits(uid, place.id, null), /見つかりません/);
  const recreated = await createPlace(uid, url);
  assert.equal(recreated.place.visitCount, 0); assert.deepEqual((await listVisits(uid, place.id, null)).visits, []);
});

test("旧データを含む状態別リストは空のページの先にもカーソルで到達できる", async () => {
  const uid = `visit-pages-${randomUUID()}`, now = Date.now(), batch = database().batch();
  for (let index = 0; index < 32; index++) {
    const id = sourceHash(`${uid}-${index}`);
    batch.set(database().doc(`users/${uid}/savedPlaces/${id}`), {
      id, deleted: false, deleteAt: null, createdAt: now - index,
      ...(index < 30 ? { visitCount: 1 } : {}),
    });
  }
  await batch.commit();
  const first = await listPlaces(uid, false, null, "saved");
  assert.deepEqual(first.places, []); assert.ok(first.nextCursor);
  const second = await listPlaces(uid, false, first.nextCursor, "saved");
  assert.equal(second.places.length, 2); assert.equal(second.nextCursor, null);
  assert.equal((await listPlaces(uid, false, null, "visited")).places.length, 30);
});

test("ジャンルを抽出・共有キャッシュへ保存し、再取得・店舗統合・訪問記録でも保持する", async () => {
  const uid = `genre-${randomUUID()}`, firstUrl = "https://genre-a.example.com/shop", secondUrl = "https://genre-b.example.com/shop";
  const firstCache = database().doc(`placeSources/${sourceHash(firstUrl)}`);
  // 旧キャッシュはジャンル未収集なので、鮮度内でもページから取得し直す。
  const source = extractionTarget(firstUrl);
  await firstCache.set({ name: "同じ店舗", address: "東京都渋谷区恵比寿1-2-3", fetchedAt: Date.now(), provenance: { ...source, method: "json-ld-v1" } });
  const html = '<script type="application/ld+json">{"@type":"Restaurant","name":"同じ店舗","address":"東京都渋谷区恵比寿1-2-3","servesCuisine":"寿司"}</script>';
  const fetcher = mockPages({ [firstUrl]: html, [secondUrl]: html });
  const first = (await createPlace(uid, firstUrl)).place;
  await processExtraction(uid, first.id, { fetcher });
  assert.equal((await firstCache.get()).get("genre"), "sushi");
  assert.equal((await listPlaces(uid, false, null)).places[0].genre, "sushi");
  await updateVisit(uid, first.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: 5, comment: "感想" });
  const second = (await createPlace(uid, secondUrl)).place;
  await processExtraction(uid, second.id, { fetcher });
  const merged = (await listPlaces(uid, false, null)).places;
  assert.equal(merged.length, 1); assert.equal(merged[0].genre, "sushi"); assert.equal(merged[0].visitCount, 1);
});

test("本人が選んだジャンルと未設定は、自動判定・店名からの推測・店舗統合で上書きしない", async () => {
  const uid = `genre-edit-${randomUUID()}`, urlA = "https://genre-edit-a.example.com/shop", urlB = "https://genre-edit-b.example.com/shop";
  for (const url of [urlA, urlB]) await database().doc(`placeSources/${sourceHash(url)}`).delete();
  const sushi = '<script type="application/ld+json">{"@type":"Restaurant","name":"鮨 こはる","address":"東京都渋谷区恵比寿1-2-3","servesCuisine":"寿司"}</script>';
  const fetcher = mockPages({ [urlA]: sushi, [urlB]: sushi });
  const first = (await createPlace(uid, urlA)).place;
  // 未設定を選ぶと、店名に「鮨」があってもジャンルを推測しない。
  assert.equal((await updatePlace(uid, first.id, { name: "鮨 こはる", address: "", note: "", genre: null })).genre, null);
  await processExtraction(uid, first.id, { fetcher });
  const firstRecord = await database().doc(`users/${uid}/savedPlaces/${first.id}`).get();
  assert.equal(firstRecord.get("genre"), null);
  assert.equal((await listPlaces(uid, false, null)).places[0].genre, null);
  // 省略時は維持し、選択したジャンルは自動判定より優先する。
  assert.equal((await updatePlace(uid, first.id, { name: "鮨 こはる", address: "東京都渋谷区恵比寿1-2-3", note: "" })).genre, null);
  assert.equal((await updatePlace(uid, first.id, { name: "鮨 こはる", address: "東京都渋谷区恵比寿1-2-3", note: "", genre: "izakaya" })).genre, "izakaya");
  const second = (await createPlace(uid, urlB)).place;
  await processExtraction(uid, second.id, { fetcher });
  const merged = (await listPlaces(uid, false, null)).places;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].genre, "izakaya");
  // 統合元で本人が選んだジャンルも、統合先が未選択なら引き継ぐ。
  const uid2 = `genre-edit-${randomUUID()}`;
  const target = (await createPlace(uid2, urlA)).place;
  await processExtraction(uid2, target.id, { fetcher });
  const source = (await createPlace(uid2, urlB)).place;
  await updatePlace(uid2, source.id, { name: "", address: "", note: "", genre: "kaiseki" });
  await processExtraction(uid2, source.id, { fetcher });
  const merged2 = (await listPlaces(uid2, false, null)).places;
  assert.equal(merged2.length, 1);
  assert.equal(merged2[0].genre, "kaiseki");
});

test("追加したジャンルを保存・読み出しでき、JSON-LDの料理分類からも細かい分類で判定する", async () => {
  const uid = `genre-new-${randomUUID()}`;
  const { place } = await createPlace(uid, "https://tabelog.com/tokyo/A1303/A130302/13000099/");
  for (const genre of ["gyoza", "beer_garden", "soup_curry", "donburi", "kissaten", "indian_curry", "hamburger", "takoyaki", "onigiri", "bento_deli", "udon", "bar", "pizza", "churrasco"] as const) {
    assert.equal((await updatePlace(uid, place.id, { name: "店", address: "", note: "", genre })).genre, genre);
    assert.equal((await listPlaces(uid, false, null)).places[0].genre, genre);
  }
  // 追加したジャンルでも絞り込める。
  assert.deepEqual((await listPlaces(uid, false, null, "all", { q: "", genre: "churrasco", sort: "newest" })).places.map(item => item.id), [place.id]);
  assert.deepEqual((await listPlaces(uid, false, null, "all", { q: "", genre: "pizza", sort: "newest" })).places, []);
  const url = "https://soup-curry.example.com/shop";
  await database().doc(`placeSources/${sourceHash(url)}`).delete();
  const html = '<script type="application/ld+json">{"@type":"Restaurant","name":"こはる","address":"北海道札幌市中央区南1条西1-2-3","servesCuisine":"スープカレー"}</script>';
  const created = (await createPlace(uid, url)).place;
  await processExtraction(uid, created.id, { fetcher: mockPages({ [url]: html }) });
  assert.equal((await database().doc(`users/${uid}/savedPlaces/${created.id}`).get()).get("genre"), "soup_curry");
});

test("マイリストを店名・住所・メモで検索し、ジャンル・状態で絞り込み、店名順でも安定してページングする", async () => {
  const uid = `search-${randomUUID()}`, other = `search-other-${randomUUID()}`;
  const add = async (n: number, fields: { name: string; address?: string; note?: string; genre?: "sushi" | "cafe" | "kissaten" | null }) => {
    const { place } = await createPlace(uid, `https://www.instagram.com/p/search${n}/`);
    await updatePlace(uid, place.id, { name: fields.name, address: fields.address ?? "", note: fields.note ?? "", ...(fields.genre !== undefined ? { genre: fields.genre } : {}) });
    return place.id;
  };
  const sushi = await add(1, { name: "鮨 こはる", address: "東京都渋谷区恵比寿1-2-3", note: "誕生日に行きたい", genre: "sushi" });
  const cafe = await add(2, { name: "ＣＯＦＦＥＥ Stand", address: "東京都目黒区中目黒1-1-1", note: "テラス席", genre: "cafe" });
  const kissa = await add(3, { name: "純喫茶 あおば", address: "東京都渋谷区道玄坂2-2-2", note: "", genre: "kissaten" });
  const unnamed = (await createPlace(uid, "https://www.instagram.com/p/search4/")).place.id;
  const trashed = await add(5, { name: "恵比寿の閉店した店", genre: null });
  await updatePlace(uid, trashed, { action: "trash" });
  await createPlace(other, "https://www.instagram.com/p/search-other/").then(({ place }) => updatePlace(other, place.id, { name: "恵比寿 他人の店", address: "", note: "" }));
  await updateVisit(uid, kissa, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: 4, comment: "" });
  const ids = async (status: "all" | "saved" | "visited", filters: { q?: string; genre?: "all" | "unset" | "sushi" | "cafe" | "kissaten"; sort?: "newest" | "name" }) =>
    (await listPlaces(uid, false, null, status, { q: "", genre: "all", sort: "newest", ...filters })).places.map((place) => place.id);

  // 空白区切りはAND、各語は店名・住所・メモのどれかに含まれれば一致。全角・大文字も正規化する。
  assert.deepEqual(await ids("all", { q: "恵比寿" }), [sushi]);
  assert.deepEqual(await ids("all", { q: "渋谷区 誕生日" }), [sushi]);
  assert.deepEqual(await ids("all", { q: "渋谷区 テラス" }), []);
  assert.deepEqual(await ids("all", { q: "coffee" }), [cafe]);
  assert.deepEqual(await ids("all", { q: "ｓｔａｎｄ" }), [cafe]);
  // ジャンルの未設定は一覧で返すgenreと一致させ、状態と組み合わせる。
  assert.deepEqual(await ids("all", { genre: "unset" }), [unnamed]);
  assert.deepEqual(await ids("all", { genre: "kissaten" }), [kissa]);
  assert.deepEqual(await ids("visited", { q: "渋谷区" }), [kissa]);
  assert.deepEqual(await ids("saved", { q: "渋谷区" }), [sushi]);
  // 店名順は日本語の照合順で、未入力は末尾。
  const byName = await ids("all", { sort: "name" });
  assert.equal(byName.at(-1), unnamed);
  assert.equal(byName.includes(trashed), false);
  const names = (await listPlaces(uid, false, null, "all", { q: "", genre: "all", sort: "name" })).places.map((place) => place.name);
  assert.deepEqual(names.slice(0, 3), [...names.slice(0, 3)].sort(new Intl.Collator("ja", { sensitivity: "base", numeric: true }).compare));
  assert.deepEqual((await listPlaces(uid, true, null, "all", { q: "閉店", genre: "all", sort: "newest" })).places.map((place) => place.id), [trashed]);

  // 同名を含む70件でも、カーソルで重複・欠落なく最後まで読める。
  const bulk = `search-bulk-${randomUUID()}`;
  const created: string[] = [];
  for (let n = 0; n < 70; n++) {
    const { place } = await createPlace(bulk, `https://www.instagram.com/p/bulk${n}/`);
    await updatePlace(bulk, place.id, { name: n % 3 ? `店 ${n % 7}` : "", address: "", note: "共通メモ" });
    created.push(place.id);
  }
  for (const sort of ["newest", "name"] as const) {
    const seen: string[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const page = await listPlaces(bulk, false, cursor, "all", { q: "共通", genre: "all", sort });
      seen.push(...page.places.map((place) => place.id));
      cursor = page.nextCursor; pages++;
    } while (cursor && pages < 10);
    assert.equal(pages, 3, sort);
    assert.equal(new Set(seen).size, 70, sort);
    assert.deepEqual([...seen].sort(), [...created].sort(), sort);
  }
  await assert.rejects(listPlaces(bulk, false, "broken", "all", { q: "共通", genre: "all", sort: "name" }), /一覧の続き/);
});
