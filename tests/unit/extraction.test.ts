import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePage, extractJsonLd } from "../../src/server/extraction/parser";
import { fetchPageFacts, isPublicAddress, robotsAllows, safeFetch, type PageFetcher } from "../../src/server/extraction/sources";

const facts = { name: "テスト店", address: "東京都渋谷区恵比寿1-2-3" };
const restaurant = { "@type": "Restaurant", ...facts };
const script = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const official = "https://shop.example.com/";
const html = (body: string, status = 200, contentType = "text/html; charset=utf-8") => ({ status, contentType, body });
// robots.txtは404（制限なし）、ページは指定した応答を返す。
const site = (page: ReturnType<typeof html>, robots = html("", 404, "text/plain")): PageFetcher => async url => url.endsWith("/robots.txt") ? robots : page;

test("JSON-LDの配列・@graph・住所参照・重複・壊れた別scriptに対応する", () => {
  assert.deepEqual(extractJsonLd(script([restaurant])), facts);
  assert.deepEqual(extractJsonLd('<script type="application/ld+json">broken</script>' + script({ "@graph": [
    { ...restaurant, address: { "@id": "#address" } },
    { "@id": "#address", "@type": "PostalAddress", addressRegion: "東京都", addressLocality: "渋谷区", streetAddress: "恵比寿1-2-3" },
    restaurant,
  ] })), facts);
  assert.deepEqual(extractJsonLd(script({ ...restaurant, "@type": ["https://schema.org/CafeOrCoffeeShop", "LocalBusiness"] })), { ...facts, genre: "cafe" });
});

test("複数店舗・住所不足・飲食店以外を勝手に確定しない", () => {
  assert.equal(extractJsonLd(script([restaurant, { ...restaurant, name: "別支店" }])), null);
  assert.equal(extractJsonLd(script([restaurant, { "@type": "Restaurant", name: "住所不明の店" }])), null);
  assert.equal(extractJsonLd(script({ ...restaurant, address: { addressRegion: "東京都" } })), null);
  assert.equal(extractJsonLd(script({ ...restaurant, "@type": "Organization" })), null);
});

test("構造化データがなければ推測せず手入力に任せる", () => {
  assert.deepEqual(analyzePage(script(restaurant)), { facts, method: "json-ld-v1" });
  for (const page of ["<html></html>", '<script type="application/ld+json">broken</script>', script({ "@type": "Restaurant", name: facts.name }), `<title>${facts.name}</title><p>${facts.address}</p>`]) {
    assert.deepEqual(analyzePage(page), { facts: null, reason: "not_found" });
  }
});

test("除外サイト・robots.txtの禁止・アクセス拒否は回避せず対象外にする", async () => {
  const noFetch: PageFetcher = async () => { throw new Error("Fetch must not run"); };
  for (const url of ["https://tabelog.com/tokyo/A1303/A130302/13323066/", "https://restaurant.ikyu.com/148322", "https://r.gnavi.co.jp/abc123/", "https://www.hotpepper.jp/strJ000000000/", "https://retty.me/area/PRE13/ARE8/SUB803/100000000000/", "https://www.instagram.com/p/example/", "https://x.com/i/status/1", "https://www.google.com/maps/place/x"]) {
    assert.deepEqual(await fetchPageFacts(url, noFetch), { facts: null, reason: "unsupported" }, url);
  }
  assert.deepEqual(await fetchPageFacts(official, site(html(script(restaurant)), html("User-agent: *\nDisallow: /", 200, "text/plain"))), { facts: null, reason: "unsupported" });
  assert.deepEqual(await fetchPageFacts(official, site(html(script(restaurant)), html("", 503, "text/plain"))), { facts: null, reason: "unsupported" });
  for (const status of [401, 403, 429, 301, 302]) assert.deepEqual(await fetchPageFacts(official, site(html("blocked", status))), { facts: null, reason: "unsupported" }, String(status));
});

test("取得の失敗は手入力に切り替え、成功時はページを1回だけ読む", async () => {
  assert.deepEqual(await fetchPageFacts(official, site(html("error", 500))), { facts: null, reason: "fetch_failed" });
  assert.deepEqual(await fetchPageFacts(official, site(html("{}", 200, "application/json"))), { facts: null, reason: "fetch_failed" });
  assert.deepEqual(await fetchPageFacts(official, async () => { throw new Error("Source too large"); }), { facts: null, reason: "fetch_failed" });
  const requested: string[] = [];
  const result = await fetchPageFacts("https://shop.example.com/menu?utm_source=sns", async (url, accept) => {
    requested.push(`${accept} ${url}`);
    return url.endsWith("/robots.txt") ? html("User-agent: *\nDisallow: /private", 200, "text/plain") : html(script(restaurant));
  });
  assert.deepEqual(result, { facts, method: "json-ld-v1" });
  assert.deepEqual(requested, ["text/plain https://shop.example.com/robots.txt", "text/html https://shop.example.com/menu"]);
});

test("robots.txtはTsugikoko向けの指定を優先し、最も長く一致した規則で判定する", () => {
  const robots = "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /";
  assert.equal(robotsAllows(robots, "/shop"), false);
  assert.equal(robotsAllows(`${robots}\n\nUser-agent: Tsugikoko\nDisallow: /admin`, "/shop"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /shop\nAllow: /shop/menu", "/shop/menu"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.php$", "/index.php"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.php$", "/index.php?x=1"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow:", "/shop"), true);
  assert.equal(robotsAllows("", "/shop"), true);
});

test("内部・ローカル・予約済みのアドレスには接続しない", async () => {
  await assert.rejects(safeFetch("http://localhost/", "text/html", 1000), /Source address not allowed/);
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "203.104.1.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(address), true, address);
});

test("店舗自身のJSON-LD料理分類を優先し、店舗情報欄・タイトルを補完に使う", async () => {
  for (const [cuisine, genre] of [["寿司", "sushi"], ["Yakiniku", "yakiniku"], ["焼き鳥", "yakitori"], ["Chinese", "chinese"], ["Italian", "italian"], ["French", "french"]]) {
    const result = analyzePage(script({ ...restaurant, servesCuisine: [cuisine] }) + '<table><tr><th>ジャンル</th><td>カフェ</td></tr></table>');
    assert.ok(result.facts); assert.equal(result.facts.genre, genre);
  }
  const { enrichGenre, cuisineLabels } = await import("../../src/server/extraction/parser");
  const html = `<title>${facts.name} - 渋谷 / フレンチ</title><nav><dl><dt>ジャンル</dt><dd>焼肉</dd></dl></nav><div itemprop="review"><table><tr><th>ジャンル</th><td>寿司</td></tr></table></div><table><tr><th>ジャンル</th><td>中華</td></tr></table>`;
  assert.deepEqual(cuisineLabels(html), ["中華"]);
  assert.equal(enrichGenre(facts, html).genre, "chinese");
  assert.equal(enrichGenre(facts, `<title>${facts.name} / イタリアン</title>`).genre, "italian");
  assert.equal(enrichGenre(facts, '<title>別店舗 - 寿司</title><p>おいしい寿司の口コミ</p>').genre, undefined);
  assert.equal(enrichGenre(facts, '<p>焼肉メニューの紹介文</p>').genre, undefined);
});
