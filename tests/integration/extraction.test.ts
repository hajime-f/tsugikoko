import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { database } from "../../src/server/firebase/admin";
import { reserveAiCall, extractWithAi } from "../../src/server/extraction/ai";
import { AiLimitError, AiUnavailableError } from "../../src/server/extraction/parser";
import { claimDispatch, createPlace, processExtraction, updatePlace } from "../../src/server/places/service";
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
    await cacheRef.set({ name: "確認用カフェ", address: "東京都渋谷区恵比寿1-2-3", fetchedAt: Date.now(), provenance: { ...source, method } });
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
    await processExtraction(uid, second.id);
    assert.equal((await database().doc(`users/${uid}/savedPlaces/${second.id}`).get()).exists, false);
    const merged = await database().doc(`users/${uid}/savedPlaces/${first.id}`).get();
    assert.equal(merged.get("note"), "最初のメモ\n\nあとのメモ");
    assert.deepEqual(merged.get("sourceUrls"), [tabelog, ikyu]);
    assert.equal(merged.get("name"), "統合カフェ");
    assert.equal((await createPlace(uid, ikyu)).place.id, first.id);
  } finally { restore(); }
});

test("本人の再取得は元ページを読み直し、通常の取得は保存済みの結果を使う", async () => {
  const uid = "refresh", url = "https://tabelog.com/tokyo/A1303/A130302/13000002/";
  const cacheRef = database().doc(`placeSources/${sourceHash(url)}`);
  const source = await resolveSource(url);
  await cacheRef.set({ name: "古い店名", address: "東京都渋谷区恵比寿1-2-3", fetchedAt: Date.now() - 60 * 60_000, provenance: { ...source, method: "json-ld-v1" } });
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
