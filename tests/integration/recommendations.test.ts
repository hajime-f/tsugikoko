import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { database } from "../../src/server/firebase/admin";
import { saveCommonPlace } from "../../src/server/places/service";
import { listDismissed, listRecommendations, recommendedPlace, setDismissed } from "../../src/server/recommendations/service";
import { getArea, setArea } from "../../src/server/areas/service";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko") throw new Error("Local demo emulator required");

const run = randomUUID().slice(0, 8);
const placeId = (name: string) => createHash("sha256").update(`${run}:${name}`).digest("hex");
const P = Object.fromEntries(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"].map(name => [name, placeId(name)])) as Record<string, string>;
const uid = (name: string) => `rec-${run}-${name}`;

async function common(name: string, fields: { genre?: string; method?: string; url?: string; address?: string } = {}) {
  await database().doc(`places/${P[name]}`).set({
    name: `共通店舗${name}`, address: fields.address ?? `東京都渋谷区恵比寿${name.slice(1)}-1-1`, genre: fields.genre ?? null,
    provenance: { url: fields.url ?? `https://${run}-${name}.example.com/`, version: "json-ld-v2", method: fields.method ?? "json-ld-v1", fetchedAt: Date.now() },
  });
}
// 他ユーザーの非公開の手入力・メモ・評価を含む保存記録を直接作る。
async function saved(owner: string, name: string, extra: { rating?: number; genre?: string; deleted?: boolean } = {}) {
  await database().doc(`users/${uid(owner)}/savedPlaces/${createHash("sha256").update(`${owner}:${name}`).digest("hex")}`).set({
    placeId: P[name], url: `https://www.instagram.com/p/${owner}-${name}/`, name: `${owner}の秘密の店名`, address: "", note: `${owner}の非公開メモ`,
    deleted: extra.deleted ?? false, createdAt: Date.now(), genre: extra.genre ?? null, visitCount: extra.rating ? 1 : 0,
    latestVisit: extra.rating ? { id: randomUUID(), visitedOn: "2024-03-01", rating: extra.rating } : null,
  });
}

test("好みが近い3人以上の支持だけで推薦し、非公開情報を返さず、興味なし・保存を即座に反映する", async () => {
  for (const name of ["p1", "p2", "p3", "p4", "p5", "p9", "p10"]) await common(name);
  await common("p6", { genre: "sushi" });
  await common("p7", { method: "gemini-text-v1" });
  await common("p8", { url: "https://tabelog.com/tokyo/A1303/A130302/13000001/" });
  await saved("me", "p1", { genre: "sushi" }); await saved("me", "p2");
  // a・b・cは本人と2店舗が重なる。dは1店舗だけなので好みが近い人には数えない。
  await saved("a", "p1"); await saved("a", "p2"); await saved("a", "p3"); await saved("a", "p4");
  // 低評価は支持に数えない。
  await saved("b", "p1"); await saved("b", "p2"); await saved("b", "p3"); await saved("b", "p4", { rating: 2 });
  await saved("c", "p1"); await saved("c", "p2", { rating: 5 }); await saved("c", "p3"); await saved("c", "p5");
  await saved("d", "p1"); await saved("d", "p5"); await saved("d", "p7"); await saved("d", "p8"); await saved("d", "p9");
  await saved("e", "p5"); await saved("e", "p7"); await saved("e", "p8");
  for (const owner of ["f", "g", "h"]) { await saved(owner, "p6"); }
  // 1店舗だけ重なる3人が支持する店舗は、好みが近い推薦ではなく人気として扱う。
  for (const owner of ["k", "l"]) { await saved(owner, "p1"); await saved(owner, "p9"); }
  // 本人がURLだけ保存した（店舗情報が未取得の）公開ページは推薦しない。
  for (const owner of ["m", "n", "o"]) await saved(owner, "p10");
  await database().doc(`users/${uid("me")}/savedPlaces/${createHash("sha256").update("me-url-only").digest("hex")}`).set({
    placeId: null, url: `https://${run}-p10.example.com/`, sourceUrls: [`https://${run}-p10.example.com/`], name: "", address: "", note: "", deleted: false, createdAt: Date.now(), genre: null,
  });
  await saved("f", "p7"); await saved("f", "p8");
  // ごみ箱の記録は支持に数えない。
  await saved("i", "p4", { deleted: true }); await saved("j", "p4", { deleted: true });
  await database().doc("recommendationModel/current").delete(); await database().doc("recommendationModel/lock").delete();

  const result = await listRecommendations(uid("me"), null);
  const ours = result.items.filter(item => Object.values(P).includes(item.id));
  assert.equal(result.mode, "personalized");
  assert.deepEqual(ours.slice(0, 2).map(item => [item.id, item.reason]), [[P.p3, "similar_tastes"], [P.p6, "preferred_genre"]]);
  // 支持者数が同じ人気の候補は共通店舗IDの順。
  assert.deepEqual(ours.slice(2).map(item => [item.id, item.reason]), [P.p5, P.p9].sort().map(id => [id, "popular"]));
  assert.equal(ours[0].name, "共通店舗p3");
  assert.equal(ours[0].url, `https://${run}-p3.example.com/`);
  const body = JSON.stringify(result);
  for (const secret of ["秘密の店名", "非公開メモ", "instagram.com", "tabelog.com", run + "-a", "rating", "visitCount"]) assert.equal(body.includes(secret), false, secret);
  assert.ok(typeof result.generatedAt === "number");

  // 興味なしは即座に外れ、設定から解除すると戻る。
  await setDismissed(uid("me"), P.p3, true);
  assert.equal((await listRecommendations(uid("me"), null)).items.some(item => item.id === P.p3), false);
  assert.deepEqual((await listDismissed(uid("me"), null)).items.map(item => item.id), [P.p3]);
  await setDismissed(uid("me"), P.p3, false);
  assert.equal((await listRecommendations(uid("me"), null)).items[0].id, P.p3);

  // 保存はサーバーが共通店舗から情報を解決し、重複保存しない。保存後は推薦から外れる。
  const first = await saveCommonPlace(uid("me"), await recommendedPlace(P.p5));
  assert.equal(first.duplicate, false);
  assert.equal(first.place.placeId, P.p5);
  assert.equal(first.place.name, "共通店舗p5");
  const again = await saveCommonPlace(uid("me"), await recommendedPlace(P.p5));
  assert.equal(again.duplicate, true);
  assert.equal(again.place.id, first.place.id);
  assert.equal((await listRecommendations(uid("me"), null)).items.some(item => item.id === P.p5), false);
  // 推薦の対象外（旧AI方式・除外サイト）は保存・興味なしの対象にもしない。
  await assert.rejects(recommendedPlace(P.p7), /おすすめが見つかりません/);
  await assert.rejects(setDismissed(uid("me"), P.p8, true), /おすすめが見つかりません/);
  await assert.rejects(listRecommendations(uid("me"), "f".repeat(64)), /おすすめが更新されました/);
});

test("保存の重なりがない利用者には好みが近い推薦を名乗らず、候補がなければ正直に空を返す", async () => {
  const stranger = await listRecommendations(uid("stranger"), null);
  assert.notEqual(stranger.mode, "personalized");
  assert.equal(stranger.items.some(item => item.reason === "similar_tastes"), false);
  // 候補をすべて興味なしにすると空になる。
  for (const item of stranger.items) await setDismissed(uid("stranger"), item.id, true);
  await database().doc(`users/${uid("stranger")}/recommendations/current`).delete();
  let page = await listRecommendations(uid("stranger"), null);
  while (page.items.length) {
    for (const item of page.items) await setDismissed(uid("stranger"), item.id, true);
    page = await listRecommendations(uid("stranger"), null);
  }
  assert.equal(page.mode, "insufficient");
  assert.equal(page.nextCursor, null);
});

test("集計が一度もできていない間の作成中・失敗後の待機は、データ不足ではなく再試行の案内にする", async () => {
  const saved = await database().doc("recommendationModel/current").get();
  try {
    await database().doc("recommendationModel/current").delete();
    await database().doc("recommendationModel/lock").set({ lockedUntil: Date.now() + 60_000, token: "other" });
    await assert.rejects(listRecommendations(uid("waiting"), null), (error: Error & { status?: number }) => error.status === 503);
  } finally {
    await database().doc("recommendationModel/lock").delete();
    if (saved.exists) await database().doc("recommendationModel/current").set(saved.data()!);
  }
});

test("利用エリアで推薦を絞り、変更すると即座に作り直し、別の地域のカーソルを混ぜない", async () => {
  await common("p11", { address: "大阪府大阪市北区梅田1-1-1" });
  await common("p12", { address: "住所非公開" });
  for (const owner of ["q", "r", "s"]) { await saved(owner, "p11"); await saved(owner, "p12"); }
  await database().doc("recommendationModel/current").delete(); await database().doc("recommendationModel/lock").delete();
  const ours = async () => (await listRecommendations(uid("me"), null)).items.map(item => item.id).filter(id => Object.values(P).includes(id));

  assert.equal(await getArea(uid("me")), null);
  const nationwide = await ours();
  assert.ok(nationwide.includes(P.p11) && nationwide.includes(P.p12) && nationwide.includes(P.p3));
  assert.equal((await listRecommendations(uid("me"), null)).area, null);

  assert.deepEqual(await setArea(uid("me"), { prefectureCode: "27", municipalityCode: "27100" }), { prefectureCode: "27", municipalityCode: "27100" });
  // 大阪市を選ぶと北区の店舗を含み、住所が分からない店舗・東京の店舗は含まない。
  assert.deepEqual(await ours(), [P.p11]);
  const osaka = await listRecommendations(uid("me"), null);
  assert.deepEqual(osaka.area, { prefectureCode: "27", municipalityCode: "27100" });

  await setArea(uid("me"), { prefectureCode: "13", municipalityCode: null });
  const tokyo = await ours();
  assert.equal(tokyo.includes(P.p11) || tokyo.includes(P.p12), false);
  assert.ok(tokyo.includes(P.p3));
  // 地域を変えたあとに、前の地域のカーソルを使えない。
  await assert.rejects(listRecommendations(uid("me"), `27100:${P.p11}`), /おすすめが更新されました/);
  // 保存されるのは地域コードだけ。
  assert.deepEqual(Object.keys((await database().doc(`users/${uid("me")}/preferences/area`).get()).data()!).sort(), ["municipalityCode", "prefectureCode", "updatedAt"]);

  await setArea(uid("me"), null);
  assert.equal((await database().doc(`users/${uid("me")}/preferences/area`).get()).exists, false);
  assert.ok((await ours()).includes(P.p11));
});

test("地域コードのない旧モデルは使わず作り直しを待ち、集計後に住所が変わった店舗は地域外として表示しない", async () => {
  const current = database().doc("recommendationModel/current"), lock = database().doc("recommendationModel/lock");
  const saved = await current.get();
  try {
    // 旧バージョンのモデルが新しくても使わず、作り直し中は503にする。
    await current.set({ generatedAt: Date.now(), version: 1, data: JSON.stringify({ truncated: false, candidates: [], places: [], profiles: {} }) });
    await lock.set({ lockedUntil: Date.now() + 60_000, token: "other" });
    await assert.rejects(listRecommendations(uid("old-model"), null), (error: Error & { status?: number }) => error.status === 503);
  } finally {
    await lock.delete();
    if (saved.exists) await current.set(saved.data()!); else await current.delete();
  }
  await setArea(uid("me"), { prefectureCode: "27", municipalityCode: "27100" });
  try {
    assert.ok((await listRecommendations(uid("me"), null)).items.some(item => item.id === P.p11));
    // 集計し直す前に共通店舗の住所が東京に変わっても、大阪市のおすすめには出さない。
    await database().doc(`places/${P.p11}`).update({ address: "東京都渋谷区恵比寿11-1-1" });
    assert.equal((await listRecommendations(uid("me"), null)).items.some(item => item.id === P.p11), false);
  } finally {
    await database().doc(`places/${P.p11}`).update({ address: "大阪府大阪市北区梅田1-1-1" });
    await setArea(uid("me"), null);
  }
});
