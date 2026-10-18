import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePage, extractJsonLd, validateAiFacts, AiLimitError, AiUnavailableError } from "../../src/server/extraction/parser";
import { fetchPageFacts, pageAiText } from "../../src/server/extraction/sources";
import { geminiRequest, requestGemini } from "../../src/server/extraction/gemini";

const facts = { name: "テストカフェ", address: "東京都渋谷区恵比寿1-2-3" };
const restaurant = { "@type": "Restaurant", ...facts };
const script = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const pageText = `${facts.name}\n${facts.address}`;
const aiResult = { unique: true, ...facts, nameEvidence: facts.name, addressEvidence: facts.address };
const official = "https://www.tabisurucafe.com/bistro-franky-hotel";

test("JSON-LDの配列・@graph・住所参照・重複・壊れた別scriptに対応する", () => {
  assert.deepEqual(extractJsonLd(script([restaurant])), facts);
  assert.deepEqual(extractJsonLd('<script type="application/ld+json">broken</script>' + script({ "@graph": [
    { ...restaurant, address: { "@id": "#address" } },
    { "@id": "#address", "@type": "PostalAddress", addressRegion: "東京都", addressLocality: "渋谷区", streetAddress: "恵比寿1-2-3" },
    restaurant,
  ] })), facts);
  assert.deepEqual(extractJsonLd(script({ ...restaurant, "@type": ["https://schema.org/CafeOrCoffeeShop", "LocalBusiness"] })), facts);
});

test("複数店舗・住所不足・飲食店以外を勝手に確定しない", () => {
  assert.equal(extractJsonLd(script([restaurant, { ...restaurant, name: "別支店" }])), null);
  assert.equal(extractJsonLd(script([restaurant, { "@type": "Restaurant", name: "住所不明の店" }])), null);
  assert.equal(extractJsonLd(script({ ...restaurant, address: { addressRegion: "東京都" } })), null);
  assert.equal(extractJsonLd(script({ ...restaurant, "@type": "Organization" })), null);
});

test("JSON-LD成功時はAIを呼ばず、失敗時だけ取得済みテキストで補完する", async () => {
  let calls = 0;
  const infer = async (text: string) => { calls++; assert.equal(text, pageText); return facts; };
  assert.deepEqual(await analyzePage(script(restaurant), () => pageText, infer), { facts, method: "json-ld-v1" });
  assert.equal(calls, 0);
  for (const html of ["<html></html>", '<script type="application/ld+json">broken</script>', script({ "@type": "Restaurant", name: facts.name })]) {
    assert.deepEqual(await analyzePage(html, () => pageText, infer), { facts, method: "gemini-text-v1" });
  }
  assert.equal(calls, 3);
});

test("根拠のないAI回答・複数候補・サイズ超過・上限到達は仮保存へ戻す", async () => {
  assert.deepEqual(validateAiFacts(aiResult, pageText), facts);
  assert.equal(validateAiFacts({ ...aiResult, address: "東京都新宿区架空1-2-3" }, pageText), null);
  assert.equal(validateAiFacts({ ...aiResult, nameEvidence: "存在しない引用" }, pageText), null);
  assert.equal(validateAiFacts({ ...aiResult, unique: false }, pageText), null);
  assert.equal(validateAiFacts({ ...aiResult, injected: true }, pageText), null);
  for (const text of ["", "x".repeat(6001), "あ".repeat(5000)]) {
    assert.deepEqual(await analyzePage("", () => text, async () => { throw new Error("must not call"); }), { facts: null, reason: "not_found" });
  }
  assert.deepEqual(await analyzePage("", () => pageText, async () => { throw new AiLimitError(); }), { facts: null, reason: "ai_limit" });
  assert.deepEqual(await analyzePage("", () => pageText, async () => { throw new AiUnavailableError(); }), { facts: null, reason: "ai_unavailable" });
});

test("未対応URL・HTTP失敗・リダイレクト・巨大HTMLではAIにアクセスを代行させない", async () => {
  const infer = async () => { throw new Error("AI must not run"); };
  const noFetch: typeof fetch = async () => { throw new Error("Fetch must not run"); };
  for (const url of ["https://tabelog.com/help/rules/", "https://restaurant.ikyu.com/", "http://169.254.169.254/"]) {
    assert.deepEqual(await fetchPageFacts(url, infer, noFetch), { facts: null, reason: "unsupported" });
  }
  for (const status of [403, 429, 302]) {
    await assert.rejects(fetchPageFacts(official, infer, async (_, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response("blocked", { status, headers: { "content-type": "text/html" } });
    }), /Source unavailable/);
  }
  await assert.rejects(fetchPageFacts(official, infer, async () => new Response("x".repeat(1_500_001), { headers: { "content-type": "text/html" } })), /Source too large/);
  let fetches = 0;
  assert.deepEqual(await fetchPageFacts(official, infer, async () => { fetches++; return new Response(script(restaurant), { headers: { "content-type": "text/html" } }); }), { facts, method: "json-ld-v1" });
  assert.equal(fetches, 1);
});

test("食べログはJSON-LD優先、一休は住所の都道府県・建物名を含めてAIへ渡す", async () => {
  assert.deepEqual(await fetchPageFacts("https://tabelog.com/tokyo/A1303/A130302/13323066/", async () => { throw new Error("unnecessary AI"); }, async () => new Response(script(restaurant), { headers: { "content-type": "text/html" } })), { facts, method: "json-ld-v1" });
  const html = `<title>${facts.name}</title><h1>${facts.name}</h1><p>東京都<span>渋谷区恵比寿1-2-3</span> ビル1階</p><svg><title>アイコン名</title></svg><div itemprop="review">東京都新宿区999 口コミ</div>`;
  const result = await fetchPageFacts("https://restaurant.ikyu.com/123456/", async text => {
    assert.ok(text.includes("東京都渋谷区恵比寿1-2-3 ビル1階"));
    assert.ok(!text.includes("アイコン名") && !text.includes("口コミ"));
    return facts;
  }, async input => {
    assert.equal(input, "https://restaurant.ikyu.com/123456");
    return new Response(html, { headers: { "content-type": "text/html" } });
  });
  assert.deepEqual(result, { facts, method: "gemini-text-v1" });
  assert.ok(pageAiText('<title>カフェ</title><footer><p>東京都<span>品川区東五反田2-5-2</span> ビル1F</p></footer>').includes("東京都品川区東五反田2-5-2 ビル1F"));
  assert.equal(pageAiText('<title>ログイン</title><form>住所を入力</form>'), "");
});

test("Geminiは構造化出力・短い出力上限を指定し、拒否や途中回答は確定しない", async () => {
  const request = geminiRequest(pageText);
  assert.equal(request.generationConfig.maxOutputTokens, 512);
  assert.ok(!("tools" in request));
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://aiplatform.googleapis.com/"));
    assert.equal(init?.redirect, "error");
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(aiResult) }] } }] });
  };
  assert.deepEqual(await requestGemini(pageText, "test-token", "demo-tsugikoko", fetcher), facts);
  for (const finishReason of ["MAX_TOKENS", "SAFETY"]) {
    assert.equal(await requestGemini(pageText, "test-token", "demo-tsugikoko", async () => Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(aiResult) }] } }] })), null);
  }
  let calls = 0;
  await assert.rejects(requestGemini(pageText, "test-token", "demo-tsugikoko", async () => { calls++; return new Response("unavailable", { status: 429 }); }), AiUnavailableError);
  assert.equal(calls, 1);
});
