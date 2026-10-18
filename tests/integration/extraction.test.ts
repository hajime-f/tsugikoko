import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { database } from "../../src/server/firebase/admin";
import { reserveAiCall, extractWithAi } from "../../src/server/extraction/ai";
import { AiLimitError, AiUnavailableError } from "../../src/server/extraction/parser";
import { claimDispatch, createPlace, listPlaces, listVisits, processExtraction, updatePlace, updateVisit } from "../../src/server/places/service";
import { reviewedSources } from "../../src/server/extraction/sources";
import { resolveSource } from "../../src/server/extraction/registry";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko") throw new Error("Local demo emulator required");
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

test("並行呼び出しでもユーザー日次・全体日次・月次のAI上限を超えない", async () => {
  const globalRef = database().doc("extractionLimits/ai"), uid = "quota-test";
  await globalRef.delete(); await database().doc(`users/${uid}/limits/ai`).delete();
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveAiCall(uid)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 10);
  assert.equal((await globalRef.get()).get("monthly"), 10);
  for (const counts of [{ daily: 30, monthly: 30 }, { daily: 0, monthly: 500 }]) {
    await globalRef.set({ day: today(), month: today().slice(0, 7), ...counts });
    await assert.rejects(reserveAiCall("another-user"), AiLimitError);
  }
  await globalRef.set({ day: "2000-01-01", month: "2000-01", daily: 30, monthly: 500 });
  await reserveAiCall("new-month");
  assert.equal((await globalRef.get()).get("monthly"), 1);
  await assert.rejects(extractWithAi("quota-test", "test"), AiUnavailableError);
});

test("JSON-LDとAIの取得結果を保存・再利用し、本人の編集を保持する", async () => {
  const source = reviewedSources[0], url = source.url;
  const cacheRef = database().doc(`placeSources/${createHash("sha256").update(url).digest("hex")}`);
  for (const method of ["json-ld-v1", "gemini-text-v1"]) {
    const uid = `cache-${method}`;
    await cacheRef.set({ name: "確認用カフェ", address: "東京都渋谷区恵比寿1-2-3", genre: null, fetchedAt: Date.now(), provenance: { ...source, method } });
    const { place } = await createPlace(uid, url);
    const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
    await ref.update({ name: "自分用の店名", note: "メモ", editedFields: ["name"], customDetails: true });
    await processExtraction(uid, place.id);
    const result = await ref.get();
    assert.equal(result.get("extraction"), "ready");
    assert.equal(result.get("name"), "自分用の店名");
    assert.equal(result.get("address"), "東京都渋谷区恵比寿1-2-3");
    assert.equal(result.get("note"), "メモ");
    assert.equal((await cacheRef.get()).get("provenance.method"), method);
  }
});

test("HTMLからJSON-LDを取得して保存し、AI停止時もURLとメモを失わない", async () => {
  const url = reviewedSources[0].url;
  const cacheRef = database().doc(`placeSources/${createHash("sha256").update(url).digest("hex")}`);
  const originalFetch = globalThis.fetch;
  try {
    for (const hasJsonLd of [true, false]) {
      await cacheRef.delete();
      const uid = `pipeline-${hasJsonLd}`, { place } = await createPlace(uid, url);
      const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
      await ref.update({ note: "残すメモ" });
      globalThis.fetch = async (input, init) => {
        if (String(input) !== url) return originalFetch(input, init);
        const html = hasJsonLd
          ? '<script type="application/ld+json">{"@type":"Restaurant","name":"JSON-LDカフェ","address":"東京都渋谷区恵比寿1-2-3"}</script>'
          : '<title>確認用カフェ</title><p>150-0000 東京都渋谷区恵比寿1-2-3</p>';
        return new Response(html, { headers: { "content-type": "text/html" } });
      };
      await processExtraction(uid, place.id);
      const result = await ref.get();
      assert.equal(result.get("url"), url);
      assert.equal(result.get("note"), "残すメモ");
      assert.equal(result.get("extraction"), hasJsonLd ? "ready" : "needs_review");
      assert.equal(result.get("reason"), hasJsonLd ? null : "ai_unavailable");
      if (hasJsonLd) assert.equal((await cacheRef.get()).get("provenance.method"), "json-ld-v1");
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("食べログ・一休の新規保存と、管理者が登録したURLだけの追加対応", async () => {
  const tabelog = "https://tabelog.com/tokyo/A1303/A130302/13323066/";
  const ikyu = "https://restaurant.ikyu.com/148322";
  for (const url of [tabelog, ikyu]) {
    const { place } = await createPlace("new-sites", url);
    assert.equal(place.extraction, "pending");
    assert.equal(place.reason, null);
  }
  const url = "https://example.com/cafe";
  const ref = database().doc(`extractionSources/${createHash("sha256").update(url).digest("hex")}`);
  assert.equal(await resolveSource(url), undefined);
  await ref.set({ url, enabled: true });
  assert.equal((await resolveSource(url))?.url, url);
  assert.equal(await resolveSource("https://example.com/another-cafe"), undefined);
  const { place } = await createPlace("extra-site", url);
  assert.equal(place.extraction, "pending");
  await ref.update({ enabled: false });
  assert.equal(await resolveSource(url), undefined);
});

const sourceHash = (url: string) => createHash("sha256").update(url).digest("hex");
function mockPages(pages: Record<string, string>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const html = pages[String(input)];
    if (html === undefined) return originalFetch(input, init);
    return new Response(html, { headers: { "content-type": "text/html" } });
  };
  return () => { globalThis.fetch = originalFetch; };
}
const jsonLd = (name: string, address: string) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name, address })}</script>`;

test("異なるURLの同じ店舗は、メモと本人の修正を引き継いで1件にまとめる", async () => {
  const uid = "merge-note", tabelog = "https://tabelog.com/tokyo/A1303/A130302/13000001/", ikyu = "https://restaurant.ikyu.com/100001";
  for (const url of [tabelog, ikyu]) await database().doc(`placeSources/${sourceHash(url)}`).delete();
  const restore = mockPages({ [tabelog]: jsonLd("統合カフェ", "東京都渋谷区恵比寿1-2-3"), [ikyu]: jsonLd("統合カフェ", "東京都渋谷区恵比寿1-2-3") });
  try {
    const first = (await createPlace(uid, tabelog)).place;
    await processExtraction(uid, first.id);
    await updatePlace(uid, first.id, { name: "統合カフェ", address: "東京都渋谷区恵比寿1-2-3", note: "最初のメモ" });
    const second = (await createPlace(uid, ikyu)).place;
    await updatePlace(uid, second.id, { name: "", address: "", note: "あとのメモ" });
    await updateVisit(uid, first.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-02-29", rating: 4, comment: "最初の訪問" });
    await updateVisit(uid, second.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: 5, comment: "再訪の感想" });
    await processExtraction(uid, second.id);
    assert.equal((await database().doc(`users/${uid}/savedPlaces/${second.id}`).get()).exists, false);
    const merged = await database().doc(`users/${uid}/savedPlaces/${first.id}`).get();
    assert.equal(merged.get("note"), "最初のメモ\n\nあとのメモ");
    assert.deepEqual(merged.get("sourceUrls"), [tabelog, ikyu]);
    assert.equal(merged.get("name"), "統合カフェ");
    assert.equal(merged.get("visitCount"), 2);
    assert.equal(merged.get("latestVisit.rating"), 5);
    assert.deepEqual((await listVisits(uid, first.id, null)).visits.map(visit => visit.comment), ["再訪の感想", "最初の訪問"]);
    assert.equal((await createPlace(uid, ikyu)).place.id, first.id);
  } finally { restore(); }
});

test("本人の再取得は元ページを読み直し、通常の取得は保存済みの結果を使う", async () => {
  const uid = "refresh", url = "https://tabelog.com/tokyo/A1303/A130302/13000002/";
  const cacheRef = database().doc(`placeSources/${sourceHash(url)}`);
  const source = await resolveSource(url);
  await cacheRef.set({ name: "古い店名", address: "東京都渋谷区恵比寿1-2-3", genre: null, fetchedAt: Date.now() - 60 * 60_000, provenance: { ...source, method: "json-ld-v1" } });
  const restore = mockPages({ [url]: jsonLd("新しい店名", "東京都渋谷区恵比寿1-2-3") });
  try {
    const { place } = await createPlace(uid, url);
    const ref = database().doc(`users/${uid}/savedPlaces/${place.id}`);
    await processExtraction(uid, place.id);
    assert.equal((await ref.get()).get("name"), "古い店名");
    await ref.update({ lastAttemptAt: Date.now() - 120_000 });
    await updatePlace(uid, place.id, { action: "retry" });
    await processExtraction(uid, place.id);
    const result = await ref.get();
    assert.equal(result.get("name"), "新しい店名");
    assert.equal(result.get("refresh"), false);
  } finally { restore(); }
});

test("取得ジョブは1回だけ登録し、処理中の記録は再試行を求める", async () => {
  const uid = "dispatch", url = "https://tabelog.com/tokyo/A1303/A130302/13000003/";
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
  const uid = `genre-${randomUUID()}`, firstUrl = "https://tabelog.com/tokyo/A1303/A130302/13000006/", secondUrl = "https://restaurant.ikyu.com/100006";
  const firstCache = database().doc(`placeSources/${sourceHash(firstUrl)}`);
  // 旧キャッシュはジャンル未収集なので、鮮度内でもページから取得し直す。
  const source = await resolveSource(firstUrl);
  await firstCache.set({ name: "同じ店舗", address: "東京都渋谷区恵比寿1-2-3", fetchedAt: Date.now(), provenance: { ...source, method: "json-ld-v1" } });
  const html = '<script type="application/ld+json">{"@type":"Restaurant","name":"同じ店舗","address":"東京都渋谷区恵比寿1-2-3","servesCuisine":"寿司"}</script>';
  const restore = mockPages({ [firstUrl]: html, [secondUrl]: html });
  try {
    const first = (await createPlace(uid, firstUrl)).place;
    await processExtraction(uid, first.id);
    assert.equal((await firstCache.get()).get("genre"), "sushi");
    assert.equal((await listPlaces(uid, false, null)).places[0].genre, "sushi");
    await updateVisit(uid, first.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-03-01", rating: 5, comment: "感想" });
    const second = (await createPlace(uid, secondUrl)).place;
    await processExtraction(uid, second.id);
    const merged = (await listPlaces(uid, false, null)).places;
    assert.equal(merged.length, 1); assert.equal(merged[0].genre, "sushi"); assert.equal(merged[0].visitCount, 1);
  } finally { restore(); }
});
