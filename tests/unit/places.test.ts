import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlaceSchema, normalizePlaceUrl } from "../../src/lib/places/schema";
import { extractionTarget } from "../../src/server/extraction/sources";

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
test("除外サイト以外の公開ページだけを自動入力の対象にする", () => {
  for (const url of ["https://tabelog.com/tokyo/A1303/A130302/13323066/", "https://s.tabelog.com/tokyo/A1303/A130302/13323066/", "https://restaurant.ikyu.com/148322", "https://www.instagram.com/p/example/", "https://twitter.com/example/status/1", "http://169.254.169.254/", "https://localhost/", "javascript:alert(1)"]) assert.equal(extractionTarget(url), undefined, url);
  assert.equal(extractionTarget("https://tabelog.com.evil.example/shop")?.url, "https://tabelog.com.evil.example/shop");
  assert.equal(extractionTarget("https://www.tabisurucafe.com/bistro-franky-hotel/")?.url, "https://www.tabisurucafe.com/bistro-franky-hotel");
  assert.equal(extractionTarget("https://shop.example.com/?utm_source=sns")?.url, "https://shop.example.com/");
});
test("訪問日の実在・未来日・整数の星評価・非公開入力を検証する", async () => {
  const { visitActionSchema, todayInJapan } = await import("../../src/lib/places/schema");
  const input = { action: "addVisit", visitId: "12345678-1234-4123-8123-123456789abc", visitedOn: todayInJapan(), rating: 5, comment: "" };
  assert.equal(visitActionSchema.safeParse(input).success, true);
  assert.equal(visitActionSchema.safeParse({ ...input, rating: null }).success, true);
  for (const visitedOn of ["2025-02-29", "2024-02-30", "2024-13-01", "1899-12-31", "9999-01-01", ""]) assert.equal(visitActionSchema.safeParse({ ...input, visitedOn }).success, false);
  assert.equal(visitActionSchema.safeParse({ ...input, visitedOn: "2024-02-29" }).success, true);
  for (const rating of [0, 6, 4.5, "5"]) assert.equal(visitActionSchema.safeParse({ ...input, rating }).success, false);
  for (const extra of [{ uid: "other" }, { visibility: "public" }, { comment: "あ".repeat(2001) }]) assert.equal(visitActionSchema.safeParse({ ...input, ...extra }).success, false);
});

test("対応ジャンルの名称から画像を選び、曖昧な店名や焼きそばは誤分類しない", async () => {
  const { genres, genreFromText, isGenre } = await import("../../src/lib/places/genres");
  const { existsSync } = await import("node:fs");
  for (const genre of Object.values(genres)) {
    assert.ok(existsSync(`public${genre.image}.avif`));
    assert.ok(existsSync(`public${genre.image}.webp`));
  }
  assert.equal(genreFromText("鮨 こはる"), "sushi");
  assert.equal(genreFromText("焼鳥 こはる"), "yakitori");
  assert.equal(genreFromText("中華そば こはる"), "ramen");
  assert.equal(genreFromText("和食・懐石料理"), "kaiseki");
  assert.equal(genreFromText("居酒屋 焼き鳥 こはる"), "yakitori");
  assert.equal(genreFromText("カフェ アフタヌーンティー"), "afternoon_tea");
  assert.equal(genreFromText("うなぎ"), "unagi");
  assert.equal(genreFromText("お好み焼・鉄板焼"), "okonomiyaki");
  assert.equal(genreFromText("鉄板焼き"), "teppanyaki");
  assert.equal(genreFromText("洋食"), "yoshoku");
  assert.equal(genreFromText("タイ料理"), "ethnic");
  assert.equal(genreFromText("居酒屋"), "izakaya");
  assert.equal(genreFromText("焼きそば専門店"), null);
  assert.equal(genreFromText("こはる"), null);
  assert.equal(isGenre("toString"), false);
  assert.equal(isGenre("../../secret"), false);
});
