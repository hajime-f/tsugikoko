import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlaceSchema, normalizePlaceUrl } from "../../src/lib/places/schema";
import { officialAiText, reviewedSource } from "../../src/server/extraction/sources";

test("店舗・投稿の識別子を保ったまま、重複URLをまとめる", () => {
  assert.equal(normalizePlaceUrl("https://tabelog.com/tokyo/A1303/A130302/13323066/dtlrvwlst/?utm_source=test#top"), "https://tabelog.com/tokyo/A1303/A130302/13323066/");
  assert.equal(normalizePlaceUrl("https://restaurant.ikyu.com/148322/plan123456?num_guests=2"), "https://restaurant.ikyu.com/148322");
  assert.equal(normalizePlaceUrl("https://tabelog.com/tokyo/A1303/A130302/13323066"), "https://tabelog.com/tokyo/A1303/A130302/13323066/");
  assert.equal(normalizePlaceUrl("https://twitter.com/example/status/123456?s=20"), "https://x.com/i/status/123456");
  assert.equal(normalizePlaceUrl("https://www.instagram.com/p/abc_123/?igsh=example"), "https://www.instagram.com/p/abc_123/");
  assert.equal(normalizePlaceUrl("https://example.com/shop?id=123&utm_medium=social"), "https://example.com/shop?id=123");
  assert.notEqual(normalizePlaceUrl("https://example.com/shop?id=123"), normalizePlaceUrl("https://example.com/shop?id=456"));
});
test("実行可能URL・認証情報・ローカル宛先・追加の所有者指定を受け付けない", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://127.0.0.1/", "http://2130706433/", "https://user:password@example.com", "http://[::1]/", "https://localhost/", "https://example.com:8080/"]) assert.equal(createPlaceSchema.safeParse({ url }).success, false, url);
  assert.equal(createPlaceSchema.safeParse({ url: "https://example.com/", uid: "another-user" }).success, false);
});
test("AIには確認した連絡先とタイトルのみを渡し、写真・紹介文は送らない", () => {
  const text = officialAiText('<title>TEST BISTRO | tabisurucafe</title><p>153-0022 東京都渋谷区恵比寿南1-17-17 - F5</p><p>創作的な紹介文</p><img src="private-photo.jpg"><p hidden>150-0000 東京都渋谷区別住所</p>');
  assert.equal(text, "TEST BISTRO | tabisurucafe\n153-0022 東京都渋谷区恵比寿南1-17-17 - F5");
  assert.equal(officialAiText('<title>TEST | tabisurucafe</title><p>住所なし</p>'), "");
});
test("許可範囲外のページを外部取得先にしない", () => {
  for (const url of ["https://tabelog.com/help/rules/", "https://restaurant.ikyu.com.evil.example/148322", "https://www.instagram.com/p/example/", "https://www.tabisurucafe.com/general-5", "https://www.tabisurucafe.com.evil.example/bistro-franky-hotel", "http://169.254.169.254/"]) assert.equal(reviewedSource(url), undefined);
  assert.ok(reviewedSource("https://www.tabisurucafe.com/bistro-franky-hotel"));
  assert.equal(reviewedSource("https://restaurant.ikyu.com/148322/")?.url, "https://restaurant.ikyu.com/148322");
  assert.equal(reviewedSource("https://tabelog.com/tokyo/A1303/A130302/13323066/")?.kind, "page");
});
