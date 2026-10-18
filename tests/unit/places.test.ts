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
  // 写真のないジャンルは装飾とジャンル名で表示する。
  for (const genre of Object.values(genres)) {
    if (!genre.image) continue;
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
  assert.equal(genreFromText("タイ料理"), "thai");
  assert.equal(genreFromText("インドネシア料理"), "ethnic");
  assert.equal(genreFromText("居酒屋"), "izakaya");
  assert.equal(genreFromText("焼きそば専門店"), null);
  // 細かい分類を汎用の分類へ落とさない。
  for (const [text, genre] of [
    ["スープカレー こはる", "soup_curry"], ["インドカレー こはる", "indian_curry"], ["欧風カレー", "curry"],
    ["純喫茶 こはる", "kissaten"], ["喫茶店", "kissaten"], ["カフェ こはる", "cafe"],
    ["ワインバー", "wine_bar"], ["ショットバー こはる", "bar"], ["Bar Koharu", "bar"], ["ビアガーデン", "beer_garden"], ["肉バル", "meat_bar"],
    ["ハンバーガー", "hamburger"], ["Koharu Burger", "hamburger"], ["バーベキュー", null],
    ["バー こはる", "bar"], ["こはる バー", "bar"], ["カクテルバー", "bar"], ["ハンバーグ", null], ["バーミキュラ", null], ["スターバックス", null],
    ["餃子の店", "gyoza"], ["飲茶・点心", "dim_sum"], ["たこ焼き", "takoyaki"], ["おにぎり専門店", "onigiri"], ["お弁当・惣菜", "bento_deli"],
    ["うどん", "udon"], ["天丼", "donburi"], ["海鮮丼", "donburi"], ["うな丼", "unagi"], ["天ぷら", "tempura"],
    ["スペイン料理", "spanish"], ["しゃぶしゃぶ", "shabushabu"], ["すき焼き", "sukiyaki"], ["もつ鍋", "hotpot"], ["土鍋ご飯", null],
    ["ブッフェ", "buffet"], ["スイーツビュッフェ", "sweets_buffet"], ["海鮮料理", "seafood"], ["割烹", "kappo"], ["京料理", "kyoto"],
    ["韓国料理", "korean"], ["ベトナム料理", "vietnamese"], ["ステーキ", "steak"], ["パスタ", "pasta"],
  ] as const) assert.equal(genreFromText(text), genre, text);
  assert.equal(genreFromText("こはる"), null);
  assert.equal(isGenre("toString"), false);
  assert.equal(isGenre("../../secret"), false);
});

test("編集のジャンルは定義済みのIDか未設定だけを受け付け、省略時は変更しない", async () => {
  const { editPlaceSchema } = await import("../../src/lib/places/schema");
  const base = { name: "店", address: "", note: "" };
  assert.equal(editPlaceSchema.parse(base).genre, undefined);
  assert.equal(editPlaceSchema.parse({ ...base, genre: null }).genre, null);
  assert.equal(editPlaceSchema.parse({ ...base, genre: "sushi" }).genre, "sushi");
  for (const genre of ["unknown", "toString", "", 1]) assert.equal(editPlaceSchema.safeParse({ ...base, genre }).success, false, String(genre));
});
