import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { providerLogin } from "./helpers";
import type { SavedPlace } from "../../src/lib/places/schema";

const official = "https://www.tabisurucafe.com/bistro-franky-hotel";
const tabelog = "https://tabelog.com/tokyo/A1303/A130302/13323066/";
const unsupported = "https://www.instagram.com/p/store_registration/";
const db = () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") throw new Error("Emulator is required");
  return getFirestore(getApps()[0] ?? initializeApp({ projectId: "demo-tsugikoko" }));
};

function listFixtures(count: number): SavedPlace[] {
  return Array.from({ length: count }, (_, index) => ({
    id: (index + 1).toString(16).padStart(64, "0"), placeId: null,
    url: `https://example.com/cafe/${index + 1}`, sourceUrls: [`https://example.com/cafe/${index + 1}`],
    name: `カフェ ${index + 1}`, address: "東京都渋谷区テスト1-2-3", note: "", customDetails: false,
    extraction: "ready", reason: null, sourceLabel: "example.com", fetchedAt: Date.now(),
    createdAt: Date.now() - index * 1000, updatedAt: Date.now(), lastAttemptAt: null,
    deleted: false, deleteAt: null, visibility: "private", visitCount: 0, latestVisit: null, genre: null,
  }));
}

// このスイートは店舗/認証を検証する。推薦の集計と表示は recommendations.spec.ts で検証する。
test.beforeEach(async ({ page }) => {
  await page.route("**/api/milestones", route => route.fulfill({ json: { total: 0, pending: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, route => route.fulfill({ json: { items: [], nextCursor: null, generatedAt: null, mode: "insufficient" } }));
});

test("未読込のお店も検索し、ジャンル・訪問状況・店名順を組み合わせる", async ({ page }, info) => {
  const email = `search-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  const database = db();
  const { uid } = await getAuth(getApps()[0]).getUserByEmail(email);
  const records = listFixtures(65).map(place => ({ ...place, genre: "sushi", editedFields: ["genre"] }));
  Object.assign(records[62], { name: "あおい寿司", note: "ＣＡＦＥ 窓際", address: "京都市", genre: "sushi" });
  Object.assign(records[63], { name: "未分類の一軒", note: "cafe 窓際", address: "京都市", genre: null });
  Object.assign(records[64], { name: "訪問した寿司", note: "cafe 窓際", address: "京都市", genre: "sushi", visitCount: 1 });
  const batch = database.batch();
  for (const place of records) batch.set(database.doc(`users/${uid}/savedPlaces/${place.id}`), place);
  await batch.commit();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(30);
  await expect(page.getByRole("article", { name: "あおい寿司" })).toHaveCount(0);
  const search = page.getByRole("search", { name: "マイリストを検索" });
  await search.getByRole("searchbox").fill("cafe 京都 窓際");
  // 入力だけでは検索しない。名前以外の項目も、全角・大小文字を正規化して検索する。
  await expect(page.getByRole("article")).toHaveCount(30);
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article", { name: "あおい寿司" })).toBeAttached();
  await page.locator("#place-genre-filter").selectOption("sushi");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "あおい寿司" })).toBeAttached();
  await page.getByRole("tab", { name: "訪問済み", exact: true }).click();
  await expect(page.getByRole("article", { name: "訪問した寿司" })).toBeAttached();
  await page.locator("#place-genre-filter").selectOption("unset");
  await expect(page.getByText("条件に合うお店が見つかりませんでした。", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "行きたい", exact: true }).click();
  await expect(page.getByRole("article", { name: "未分類の一軒" })).toBeAttached();
  await page.screenshot({ path: info.outputPath("place-search-mobile-desktop.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "条件をクリア", exact: true }).click();
  await expect(search.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(30);
  await page.locator("#place-sort").selectOption("name");
  await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "あおい寿司");
  await page.getByRole("button", { name: "もっと見る", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(60);
  await page.getByRole("button", { name: "もっと見る", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(64);
  // 条件変更では古いカーソルを持ち越さず、先頭ページから検索し直す。
  await search.getByRole("searchbox").fill("存在しないお店");
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText("条件に合うお店が見つかりませんでした。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "検索・絞り込みを解除" }).click();
  await expect(page.locator("#place-sort")).toHaveValue("newest");
  await expect(page.getByRole("article")).toHaveCount(30);
});

test("検索条件を変えた後は古い応答を無視し、検索中は自動更新しない", async ({ page }, info) => {
  const [place] = listFixtures(1);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delayed = false, filteredReads = 0;
  await page.route("**/api/places?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("q") === "古い検索") {
      delayed = true; await gate;
      await route.fulfill({ json: { places: [{ ...place, name: "古い検索のお店" }], nextCursor: null } }); return;
    }
    if (params.get("genre") === "sushi") filteredReads++;
    await route.fulfill({ json: { places: [{ ...place, name: "最新の条件のお店", extraction: "pending" }], nextCursor: null } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `search-race-${info.project.name}-${Date.now()}@example.test`);
  const search = page.getByRole("search", { name: "マイリストを検索" });
  await search.getByRole("searchbox").fill("古い検索");
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect.poll(() => delayed).toBe(true);
  await page.getByRole("button", { name: "条件をクリア", exact: true }).click();
  await page.locator("#place-genre-filter").selectOption("sushi");
  await expect(page.getByRole("article", { name: "最新の条件のお店" })).toBeAttached();
  const response = page.waitForResponse(res => new URL(res.url()).searchParams.get("q") === "古い検索");
  release(); await response;
  await expect(page.getByRole("article", { name: "古い検索のお店" })).toHaveCount(0);
  const reads = filteredReads;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // 通常の3秒間隔を超えても、検索中は全件読み取りを繰り返さない。
  await page.waitForTimeout(3500);
  expect(filteredReads).toBe(reads);
});

test("スクロールで続きを読み込み、失敗の再試行と自動更新でも一覧・位置を保つ", async ({ page }, info) => {
  const places = listFixtures(65);
  const cursors: number[] = [];
  let failNext = true;
  await page.route("**/api/places?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("cursor") ?? 0);
    cursors.push(offset);
    if (offset === 30 && failNext) {
      failNext = false;
      await route.fulfill({ status: 503, json: { error: "続きを読み込めませんでした。" } });
      return;
    }
    await route.fulfill({ json: { places: places.slice(offset, offset + 30), nextCursor: offset + 30 < places.length ? String(offset + 30) : null } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `lazy-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("article")).toHaveCount(30);
  expect(cursors).toEqual([0]);
  await expect(page.locator(".member-header").getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "モバイルナビゲーション" })).toHaveCount(0);
  await expect(page.locator(".member-header").getByRole("button", { name: "アカウントを開く" })).toBeVisible();
  await page.getByRole("button", { name: "もっと見る", exact: true }).scrollIntoViewIfNeeded();
  const retry = page.getByRole("button", { name: "続きを再読み込み", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(30);
  expect(cursors.filter(offset => offset === 30)).toHaveLength(1);
  await retry.click();
  await expect(page.getByRole("article")).toHaveCount(60);
  await page.getByRole("button", { name: "もっと見る", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(65);
  await expect(page.getByRole("button", { name: "もっと見る", exact: true })).toHaveCount(0);
  expect(cursors.filter(offset => offset === 60)).toHaveLength(1);

  await page.getByRole("article", { name: "カフェ 65", exact: true }).scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  // 先頭以外のページにも更新を反映し、未取得状態の定期ポーリングを発生させる。
  places[39].extraction = "pending";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("article", { name: "カフェ 40", exact: true })).toContainText("情報を取得中");
  await expect(page.getByRole("article")).toHaveCount(65);
  // 高さの変化による自然な位置調整を避け、確認前に最後のカードへ合わせる。
  await page.getByRole("article", { name: "カフェ 65", exact: true }).scrollIntoViewIfNeeded();
  const pendingScrollY = await page.evaluate(() => window.scrollY);
  places[39].name = "更新済みカフェ 40";
  await expect(page.getByRole("article", { name: "更新済みカフェ 40", exact: true })).toBeAttached({ timeout: 10_000 });
  await expect(page.getByRole("article")).toHaveCount(65);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - pendingScrollY)).toBeLessThan(5);
  expect(scrollY).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("article", { name: "カフェ 50", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "あなたのマイリスト", exact: true })).not.toBeInViewport();
  await expect(page.getByRole("search", { name: "マイリストを検索" })).not.toBeInViewport();
  await expect(page.getByRole("tab", { name: "行きたい", exact: true })).not.toBeInViewport();
  await page.screenshot({ path: info.outputPath("my-list-scrolled.png") });
});

test("追加読み込み中にごみ箱へ切り替えても古い応答を混ぜない", async ({ page }, info) => {
  const places = listFixtures(31);
  const trash = { ...places[0], name: "ごみ箱のカフェ", deleted: true, deleteAt: Date.now() + 86400000 };
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/places?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("trash") === "1") {
      await route.fulfill({ json: { places: [trash], nextCursor: null } }); return;
    }
    if (params.has("cursor")) {
      requested = true; await gate;
      await route.fulfill({ json: { places: places.slice(30), nextCursor: null } }); return;
    }
    await route.fulfill({ json: { places: places.slice(0, 30), nextCursor: "30" } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `lazy-switch-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("article")).toHaveCount(30);
  await page.getByRole("button", { name: "もっと見る", exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText("続きを読み込んでいます...", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ごみ箱", exact: true }).click();
  await expect(page.getByRole("article", { name: "ごみ箱のカフェ", exact: true })).toBeVisible();
  const response = page.waitForResponse(res => new URL(res.url()).searchParams.has("cursor"));
  release(); await response;
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "マイリストに戻る" }).click();
  await expect(page.getByRole("article")).toHaveCount(30);
  await expect(page.getByRole("article", { name: "ごみ箱のカフェ", exact: true })).toHaveCount(0);
});

test("URL登録・重複防止・編集・再ログイン・ごみ箱を通して確認する", async ({ page }, info) => {
  // URL共通情報が別テストの入力補助に混ざらないよう、実際の投稿IDを分離する。
  const unsupported = `https://www.instagram.com/p/registration_${info.project.name}_${randomUUID()}/`;
  const email = `places-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  await page.getByLabel("登録するお店や投稿のURL").fill(unsupported);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.getByRole("article", { name: "Instagramの保存URL" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("情報確認待ち");
  await expect(card).toContainText("「編集」から店名・住所を入力できます。");
  await expect(card.getByRole("button", { name: "編集", exact: true })).toHaveCSS("background-color", "rgb(8, 127, 91)");
  await expect(page.getByRole("button", { name: "再取得", exact: true })).toHaveCount(0);
  await expect(card.getByRole("link")).toHaveAttribute("href", unsupported);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${unsupported}?utm_source=test`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await expect(page.getByText("このURLは登録済みです。保存済みのお店をご確認ください。")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("dialog").getByLabel("店名", { exact: true }).fill("次の休日のお店");
  await page.getByRole("dialog").getByLabel("住所", { exact: true }).fill("東京都渋谷区テスト1-2-3 A&Bビル");
  await page.getByRole("dialog").getByLabel("自分用メモ").fill("窓際の席が気になる");
  const genreSelect = page.getByRole("dialog").getByLabel("ジャンル", { exact: true });
  await expect(genreSelect).toHaveValue("");
  await expect(genreSelect.locator('option[value="kissaten"]')).toHaveCount(0);
  await expect(genreSelect.locator('option[value="cafe"]')).toHaveText("カフェ・喫茶店");
  await genreSelect.selectOption({ label: "寿司" });
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const edited = page.getByRole("article", { name: "次の休日のお店" });
  const mapLink = edited.getByRole("link", { name: /Google マップで開く/ });
  await expect(mapLink).toHaveAttribute("target", "_blank");
  const mapUrl = new URL((await mapLink.getAttribute("href"))!);
  expect(mapUrl.origin + mapUrl.pathname).toBe("https://www.google.com/maps/search/");
  expect(mapUrl.searchParams.get("api")).toBe("1");
  expect(mapUrl.searchParams.get("query")).toBe("次の休日のお店 東京都渋谷区テスト1-2-3 A&Bビル");
  await expect(edited.getByRole("button", { name: "編集", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(edited.locator(".place-status-copy")).toHaveCount(0);
  await expect(edited.locator(".saved-place-top")).toHaveAttribute("data-genre", "sushi");
  await page.reload();
  await expect(page.getByRole("article", { name: "次の休日のお店" })).toContainText("窓際の席が気になる");
  await expect(edited.getByRole("button", { name: "編集", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await edited.getByRole("button", { name: "編集", exact: true }).click();
  await expect(genreSelect).toHaveValue("sushi");
  // 別ジャンルへ変更すると、名称と対応する写真も切り替わる。
  await genreSelect.selectOption({ label: "グリル" });
  await page.screenshot({ path: info.outputPath("genre-edit.png"), animations: "disabled" });
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(edited.locator(".place-genre-caption")).toContainText("グリル");
  await expect(edited.getByRole("img", { name: "グリルのイメージ写真（実店舗の写真ではありません）", exact: true })).toBeVisible();
  await page.reload();
  await edited.getByRole("button", { name: "編集", exact: true }).click();
  await expect(genreSelect).toHaveValue("grill");
  // メモだけの保存ではジャンルを送らず、本人の選択を維持する。
  const unchangedRequest = page.waitForRequest(request => request.method() === "PATCH" && request.url().includes("/api/places/"));
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await unchangedRequest).postDataJSON()).not.toHaveProperty("genre");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // 追加ジャンルとカフェの差し替え画像を、実APIの保存・絞り込み・再表示まで確認する。
  for (const [id, label] of [["pizza", "ピザ"], ["churrasco", "シュラスコ"], ["cafe", "カフェ・喫茶店"]]) {
    await edited.getByRole("button", { name: "編集", exact: true }).click();
    await genreSelect.selectOption({ label });
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(edited.locator(".saved-place-top")).toHaveAttribute("data-genre", id);
    const photo = edited.getByRole("img", { name: `${label}のイメージ写真（実店舗の写真ではありません）`, exact: true });
    await expect(photo).toHaveAttribute("src", `/images/genres/${id}-provided.webp`);
    await expect.poll(() => photo.evaluate((image: HTMLImageElement, genreId) => image.complete && image.naturalWidth > 0 && image.currentSrc.endsWith(`/${genreId}-provided.avif`), id)).toBe(true);
    await page.locator("#place-genre-filter").selectOption(id);
    await expect(edited).toBeVisible();
    await edited.screenshot({ path: info.outputPath(`genre-${id}.png`), animations: "disabled" });
    await page.reload();
    await expect(edited.locator(".saved-place-top")).toHaveAttribute("data-genre", id);
  }
  await edited.getByRole("button", { name: "編集", exact: true }).click();
  await genreSelect.selectOption("");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(edited.locator(".place-genre-caption")).toHaveCount(0);
  await expect(edited.locator(".place-art")).toHaveCount(1);
  await edited.getByRole("button", { name: "編集", exact: true }).click();
  await expect(genreSelect).toHaveValue("");
  await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("saved-places.png"), fullPage: true });
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page.getByRole("article", { name: "次の休日のお店" })).toBeVisible();
  await page.getByRole("button", { name: "次の休日のお店をごみ箱へ移す" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "ごみ箱へ移す", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "ごみ箱", exact: true }).click();
  await expect(page.getByRole("article", { name: "次の休日のお店" })).toBeVisible();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "マイリストに戻る" }).click();
  await expect(page.getByRole("article", { name: "次の休日のお店" })).toContainText("窓際の席が気になる");
});

test("自動補完の結果を保存し、未認証・他ユーザーのアクセスを拒否する", async ({ request }, info) => {
  const response = await request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", { data: { email: `api-${info.project.name}-${Date.now()}@example.test`, password: "test-password-123", returnSecureToken: true } });
  const owner = await response.json();
  const otherResponse = await request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", { data: { email: `other-${info.project.name}-${Date.now()}@example.test`, password: "test-password-123", returnSecureToken: true } });
  const other = await otherResponse.json();
  const headers = { Authorization: `Bearer ${owner.idToken}` };
  // 取得元への負荷を避け、検証用の取得済み事実をエミュレーターにだけ投入する。
  await db().doc(`placeSources/${createHash("sha256").update(official).digest("hex")}`).set({ name: "検証用ビストロ", address: "東京都渋谷区テスト1-2-3", genre: null, fetchedAt: Date.now(), provenance: { version: "json-ld-v2", method: "json-ld-v1" } });
  expect((await request.get("/api/places")).status()).toBe(401);
  expect((await request.post("/api/places", { data: { url: official } })).status()).toBe(401);
  expect((await request.get("/api/places", { headers: { Authorization: "Bearer invalid" } })).status()).toBe(401);
  expect((await request.post("/api/places", { headers, data: { url: "http://127.0.0.1:8080/" } })).status()).toBe(400);
  expect((await request.post("/api/places", { headers, data: { url: official, uid: other.localId } })).status()).toBe(400);
  const saves = await Promise.all([1, 2].map(() => request.post("/api/places", { headers, data: { url: official } })));
  expect(saves.map((result) => result.status()).sort()).toEqual([200, 201]);
  const { place } = await saves[0].json();
  await expect.poll(async () => (await (await request.get("/api/places", { headers })).json()).places[0]?.extraction).toBe("ready");
  const listing = await request.get("/api/places", { headers });
  expect(listing.headers()["cache-control"]).toContain("no-store");
  expect((await listing.json()).places).toMatchObject([{ name: "検証用ビストロ", visibility: "private" }]);
  // メモだけ追記して取得処理が中断した状態から、一覧の再表示で再開する。
  await db().doc(`users/${owner.localId}/savedPlaces/${place.id}`).update({ name: "", address: "", note: "先に書いたメモ", customDetails: true, editedFields: [], extraction: "pending", lastAttemptAt: null });
  await expect.poll(async () => (await (await request.get("/api/places", { headers })).json()).places[0]?.name).toBe("検証用ビストロ");
  expect((await (await request.get("/api/places", { headers })).json()).places[0].note).toBe("先に書いたメモ");
  // Cloud Tasks無効時は新しいqueuedAtが残っていても、90秒のリース切れ後に再開できる。
  await db().doc(`users/${owner.localId}/savedPlaces/${place.id}`).update({ name: "", extraction: "pending", lastAttemptAt: Date.now() - 91_000, queuedAt: Date.now() });
  await expect.poll(async () => (await (await request.get("/api/places", { headers })).json()).places[0]?.name).toBe("検証用ビストロ");
  const otherHeaders = { Authorization: `Bearer ${other.idToken}` };
  expect((await (await request.get("/api/places", { headers: otherHeaders })).json()).places).toEqual([]);
  expect((await request.patch(`/api/places/${place.id}`, { headers: otherHeaders, data: { action: "trash" } })).status()).toBe(404);
  expect((await request.patch(`/api/places/${place.id}`, { headers, data: { name: "自分の呼び名", address: "追記した住所", note: "非公開" } })).status()).toBe(200);
  expect((await request.patch(`/api/places/${place.id}`, { headers, data: { action: "retry" } })).status()).toBe(429);
  await db().doc(`users/${owner.localId}/savedPlaces/${place.id}`).update({ lastAttemptAt: Date.now() - 61_000 });
  expect((await request.patch(`/api/places/${place.id}`, { headers, data: { action: "retry" } })).status()).toBe(200);
  await expect.poll(async () => (await (await request.get("/api/places", { headers })).json()).places[0]?.extraction).toBe("ready");
  expect((await (await request.get("/api/places", { headers })).json()).places[0]).toMatchObject({ name: "自分の呼び名", address: "追記した住所", note: "非公開" });
  expect((await request.patch(`/api/places/${place.id}`, { headers, data: { action: "trash" } })).status()).toBe(200);
  await db().doc(`users/${owner.localId}/savedPlaces/${place.id}`).update({ deleteAt: Date.now() - 1 });
  expect((await (await request.get("/api/places?trash=1", { headers })).json()).places).toEqual([]);
  expect((await request.patch(`/api/places/${place.id}`, { headers, data: { action: "restore" } })).status()).toBe(404);
  await db().doc(`users/${owner.localId}/limits/writes`).set({ minute: Math.floor(Date.now() / 60000), perMinute: 20, day: Math.floor(Date.now() / 86400000), perDay: 20 });
  expect((await request.post("/api/places", { headers, data: { url: tabelog } })).status()).toBe(429);
});

test("訪問と再訪を記録し、通信失敗の再試行・履歴の編集・削除・再読み込みを確認する", async ({ page }, info) => {
  const unsupported = `https://www.instagram.com/p/visits_${info.project.name}_${randomUUID()}/`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `visits-${info.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(unsupported);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.getByRole("article", { name: "Instagramの保存URL" });
  await card.getByRole("button", { name: "行ってきた", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("訪問日", { exact: true }).fill("2024-03-01");
  await dialog.getByRole("radio", { name: "4つ星", exact: true }).check();
  // サーバーでは保存が完了し、応答だけ失われた場合でも再送で記録を増やさない。
  let fail = true;
  await page.route("**/api/places/*", async route => {
    if (route.request().method() === "PATCH" && route.request().postDataJSON().action === "addVisit" && fail) {
      fail = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.fulfill({ status: 503, json: { error: "保存結果を確認できませんでした。" } });
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "訪問を記録する", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存結果を確認できませんでした。");
  await expect(dialog.getByLabel("訪問日", { exact: true })).toHaveValue("2024-03-01");
  await dialog.getByRole("button", { name: "訪問を記録する", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog).toContainText("4 / 5");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByRole("tab", { name: "訪問済み", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(card).toContainText("1回訪問");
  await page.getByRole("tab", { name: "行きたい", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("tab", { name: "訪問済み", exact: true }).click();
  await card.getByRole("button", { name: "再訪を記録", exact: true }).click();
  await dialog.getByLabel("訪問日", { exact: true }).fill("2024-03-02");
  await dialog.getByLabel("感想（任意）", { exact: true }).fill("コーヒーがおいしかった。また行きたい。");
  await expect(dialog.getByRole("radio", { name: "未評価", exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("visit-form.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "訪問を記録する", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByRole("listitem").first()).toContainText("未評価");
  await dialog.getByRole("listitem").first().getByRole("button", { name: "記録を編集", exact: true }).click();
  await dialog.getByRole("radio", { name: "5つ星", exact: true }).check();
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog.getByRole("listitem").first()).toContainText("5 / 5");
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("visit-history.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await page.getByRole("tab", { name: "訪問済み", exact: true }).click();
  await expect(card).toContainText("2回訪問");
  await expect(card).toContainText("5 / 5");
  await card.getByRole("button", { name: "訪問履歴（2）", exact: true }).click();
  for (const remaining of [1, 0]) {
    await dialog.getByRole("listitem").first().getByRole("button", { name: "記録を削除", exact: true }).click();
    await dialog.getByRole("button", { name: "この訪問記録を削除", exact: true }).click();
    await expect(dialog.getByRole("listitem")).toHaveCount(remaining);
  }
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByRole("tab", { name: "行きたい", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(card.getByRole("button", { name: "行ってきた", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("訪問APIは本人だけに履歴を返し、評価と日付・所有者の改ざんを拒否する", async ({ request }, info) => {
  async function account(prefix: string) {
    return (await request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", { data: { email: `${prefix}-${info.project.name}-${Date.now()}@example.test`, password: "test-password-123", returnSecureToken: true } })).json();
  }
  const owner = await account("visit-owner"), other = await account("visit-other");
  const headers = { Authorization: `Bearer ${owner.idToken}` }, otherHeaders = { Authorization: `Bearer ${other.idToken}` };
  const { place } = await (await request.post("/api/places", { headers, data: { url: unsupported } })).json();
  const path = `/api/places/${place.id}`;
  const input = { action: "addVisit", visitId: "12345678-1234-4123-8123-123456789abc", visitedOn: "2024-03-01", rating: 5, comment: "本人だけの感想" };
  expect((await request.patch(path, { data: input })).status()).toBe(401);
  expect((await request.patch(path, { headers: otherHeaders, data: input })).status()).toBe(404);
  for (const invalid of [{ rating: 6 }, { rating: 4.5 }, { visitedOn: "2024-02-30" }, { visitedOn: "9999-01-01" }, { uid: other.localId }, { visibility: "public" }]) {
    expect((await request.patch(path, { headers, data: { ...input, ...invalid } })).status()).toBe(400);
  }
  expect((await request.patch(path, { headers, data: input })).status()).toBe(200);
  expect((await request.get(path)).status()).toBe(401);
  expect((await request.get(path, { headers: otherHeaders })).status()).toBe(404);
  const result = await request.get(path, { headers });
  expect(result.headers()["cache-control"]).toContain("private, no-store");
  expect((await result.json()).visits).toMatchObject([{ comment: input.comment, rating: 5 }]);
  const visited = (await (await request.get("/api/places?status=visited", { headers })).json()).places;
  expect(visited).toMatchObject([{ visitCount: 1, latestVisit: { rating: 5 }, visibility: "private" }]);
  expect(visited[0].visits).toBeUndefined();
  expect((await (await request.get("/api/places?status=saved", { headers })).json()).places).toEqual([]);
  expect((await (await request.get("/api/places?status=visited", { headers: otherHeaders })).json()).places).toEqual([]);
});

test("提供画像で追加したジャンルを選択・保存し、再読み込み後も画像を表示する", async ({ page }, info) => {
  const { genres } = await import("../../src/lib/places/genres");
  const additions = ["gyoza", "beer_garden", "soup_curry", "donburi", "cafe", "indian_curry", "hamburger", "takoyaki", "onigiri", "bento_deli", "udon", "bar"] as const;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `genre-additions-${info.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(unsupported);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.getByRole("article");
  for (const id of additions) {
    await card.getByRole("button", { name: "編集", exact: true }).click();
    const select = page.getByRole("dialog").getByLabel("ジャンル", { exact: true });
    await select.selectOption({ label: genres[id].label });
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(card.locator(".saved-place-top")).toHaveAttribute("data-genre", id);
    const photo = card.getByRole("img", { name: `${genres[id].label}のイメージ写真（実店舗の写真ではありません）`, exact: true });
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await card.getByRole("button", { name: "編集", exact: true }).click();
    await expect(select).toHaveValue(id);
    await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).click();
  }
});

test("ジャンルごとの軽量画像を遅延読み込みし、不明な店舗は従来の装飾を表示する", async ({ page }, info) => {
  const { genres } = await import("../../src/lib/places/genres");
  const entries = Object.entries(genres);
  const places = listFixtures(entries.length + 1).map((place, index) => ({ ...place, name: entries[index] ? `画像テスト ${entries[index][1].label}` : "ジャンル不明の店", genre: entries[index]?.[0] ?? null }));
  await page.route("**/api/places?*", route => route.fulfill({ json: { places, nextCursor: null } }));
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `genre-images-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("article")).toHaveCount(entries.length + 1);
  await expect(page.getByRole("button", { name: "再取得", exact: true })).toHaveCount(0);
  for (const [, genre] of entries) {
    const card = page.getByRole("article", { name: `画像テスト ${genre.label}`, exact: true });
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".place-genre-caption")).toContainText(genre.label);
    if (!genre.image) {
      await expect(card.locator("img")).toHaveCount(0);
      await expect(card.locator(".place-art")).toHaveCount(1);
      continue;
    }
    const img = card.getByRole("img", { name: `${genre.label}のイメージ写真（実店舗の写真ではありません）`, exact: true });
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).pathname)).toBe(`${genre.image}.avif`);
    await expect(card.locator(".place-genre-caption")).toContainText(genre.label);
  }
  const unknown = page.getByRole("article", { name: "ジャンル不明の店", exact: true });
  await expect(unknown.locator("img")).toHaveCount(0);
  await expect(unknown.locator(".place-art")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("article").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("genre-cards.png"), animations: "disabled" });
});


test("別ユーザーが同じURLを登録すると店舗の基本情報だけを再利用する", async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const source = `https://www.instagram.com/p/shared-${suffix}/`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `share-a-${suffix}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(source);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.locator("#my-places article");
  await card.getByRole("button", { name: "編集", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("同じURLを保存する人の入力補助にも使います");
  await dialog.getByLabel("店名", { exact: true }).fill("共有のカフェ");
  await dialog.getByLabel("住所", { exact: true }).fill("東京都渋谷区神南1-2-3");
  await dialog.getByLabel("ジャンル", { exact: true }).selectOption("cafe");
  await dialog.getByLabel("自分用メモ").fill("私だけの秘密のメモ");
  await dialog.getByRole("button", { name: "変更を保存" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `share-b-${suffix}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${source}?utm_source=shared`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await expect(card).toContainText("共有のカフェ");
  await expect(card).toContainText("東京都渋谷区神南1-2-3");
  await expect(card).toContainText("カフェ・喫茶店");
  await expect(card).not.toContainText("私だけの秘密のメモ");
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await expect(dialog.getByLabel("自分用メモ")).toHaveValue("");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await expect(card).toContainText("共有のカフェ");
});

test("5件の登録を祝い、閉じた節目は再読込と重複保存でも再表示しない", async ({ page }, info) => {
  await page.unroute("**/api/milestones");
  const suffix = `${info.project.name}-${Date.now()}`;
  const email = `milestone-${suffix}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  const database = db();
  const { uid } = await getAuth(getApps()[0]).getUserByEmail(email);
  const batch = database.batch();
  for (const place of listFixtures(4)) batch.set(database.doc(`users/${uid}/savedPlaces/${place.id}`), place);
  await batch.commit();
  await page.reload();
  const notice = page.getByRole("complementary", { name: "お店登録のお祝い" });
  await expect(page.locator("#my-places article")).toHaveCount(4);
  await expect(notice).toHaveCount(0);
  const source = `https://www.instagram.com/p/milestone-${suffix}/`;
  await page.getByLabel("登録するお店や投稿のURL").fill(source);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await expect(notice).toContainText("お店の登録が5件に達しました。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("milestone.png"), animations: "disabled" });
  await notice.getByRole("button", { name: "お祝いを閉じる" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#my-places article")).toHaveCount(5);
  await expect(notice).toHaveCount(0);
  await page.getByLabel("登録するお店や投稿のURL").fill(source);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await expect(page.getByText("このURLは登録済みです。保存済みのお店をご確認ください。", { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  // 途中の節目を連続表示せず、最大の20件だけを表示する。
  const more = database.batch();
  for (const place of listFixtures(20).slice(4)) more.set(database.doc(`users/${uid}/savedPlaces/${place.id}`), place);
  await more.commit();
  await page.reload();
  await expect(notice).toContainText("お店の登録が20件に達しました。");
  await expect(notice).toContainText("素晴らしいです！");
  await notice.getByRole("button", { name: "お祝いを閉じる" }).click();
  await expect(notice).toHaveCount(0);
  expect((await database.doc(`users/${uid}/milestones/state`).get()).get("shownThreshold")).toBe(20);
});

test("SNS共有は店名とURLだけを渡し、コピーと端末共有に対応する", async ({ page }, info) => {
  const [place] = listFixtures(1);
  Object.assign(place, { name: "寿司 & カフェ #1", url: "https://example.com/cafe?a=1&b=2", note: "非公開の秘密メモ", latestVisit: { rating: 4, visitedOn: "2026-10-18" }, visitCount: 1 });
  const preview = `${place.name}\n${place.url}`;
  await page.route("**/api/places?*", route => route.fulfill({ json: { places: [place], nextCursor: null } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { sessionStorage.setItem("test:copied", text); } } });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => { sessionStorage.setItem("test:shared", JSON.stringify(data)); throw new DOMException("Cancelled", "AbortError"); } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `share-${info.project.name}-${Date.now()}@example.test`);
  const card = page.getByRole("article", { name: place.name, exact: true });
  await card.getByRole("button", { name: "共有", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toHaveValue(preview);
  await expect(dialog).not.toContainText(place.note);
  for (const [label, endpoint] of [["Xで投稿", "https://x.com/intent/tweet"], ["LINEで送る", "https://social-plugins.line.me/lineit/share"]]) {
    const link = dialog.getByRole("link", { name: label });
    const url = new URL((await link.getAttribute("href"))!);
    expect(url.origin + url.pathname).toBe(endpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({ text: place.name, url: place.url });
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await dialog.getByRole("button", { name: "投稿文をコピー" }).click();
  await expect(dialog.getByRole("status")).toContainText("コピーしました");
  expect(await page.evaluate(() => sessionStorage.getItem("test:copied"))).toBe(preview);
  await dialog.getByRole("button", { name: "その他の共有" }).click();
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem("test:shared")))!)).toEqual({ text: place.name, url: place.url });
  await expect(dialog.getByRole("status")).toHaveText("");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await dialog.getByRole("button", { name: "投稿文をコピー" }).click();
  await expect(dialog.getByRole("status")).toContainText("コピーできませんでした");
  await expect(dialog.getByRole("textbox", { name: "投稿内容" })).toHaveValue(preview);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("share-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("button", { name: "共有", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "ツギココをSNSで紹介", exact: true }).click();
  const siteDialog = page.getByRole("dialog", { name: "ツギココをSNSで紹介" });
  await expect(siteDialog.getByRole("textbox", { name: "投稿内容" })).toHaveValue("気になったら、ツギココ。\nSNSやグルメサイトで見つけた行きたいお店を、ひとつのマイリストに。\nhttps://tsugikoko.com");
  await expect(siteDialog).not.toContainText(place.note);
  await expect(siteDialog).not.toContainText("テストユーザー");
});

test("用途別リストを作成し、複数所属・検索・名前変更・削除を使う", async ({ page }, info) => {
  const email = `collections-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await page.getByLabel("登録するお店や投稿のURL").fill(`https://www.instagram.com/p/lists_${info.project.name}_${Date.now()}/`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await page.getByRole("button", { name: "保存したお店をリストに追加", exact: true }).click();
  const member = page.getByRole("dialog", { name: "所属リストを選ぶ" });
  await expect(member.getByText("リストはまだありません。下の欄から作成できます。")).toBeVisible();
  for (const name of ["京都旅行", "デート"]) {
    await member.getByRole("textbox", { name: "新しいリストを作成" }).fill(name);
    await member.getByRole("button", { name: "リストを作成", exact: true }).click();
    await expect(member.getByRole("checkbox", { name })).toBeChecked();
  }
  await member.getByRole("button", { name: "所属を保存", exact: true }).click();
  await expect(member).toHaveCount(0);
  const card = page.getByRole("article").first();
  await expect(card.locator(".place-collections")).toContainText("京都旅行");
  await expect(card.locator(".place-collections")).toContainText("デート");
  await card.getByRole("button", { name: "編集", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "お店の情報を編集" });
  await edit.getByLabel("店名", { exact: true }).fill("京都のお気に入り");
  await edit.getByLabel("自分用メモ").fill("窓際に座りたい");
  await edit.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await page.getByLabel("リスト", { exact: true }).selectOption({ label: "京都旅行" });
  const search = page.getByRole("search", { name: "マイリストを検索" });
  await search.getByRole("searchbox").fill("窓際");
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("article", { name: "京都のお気に入り", exact: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "訪問済み", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("tab", { name: "行きたい", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "リスト管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "リスト管理" });
  await manager.getByRole("button", { name: "京都旅行の名前を変更" }).click();
  await manager.getByRole("textbox", { name: "新しいリスト名" }).fill("秋の京都");
  await manager.getByRole("button", { name: "名前を保存", exact: true }).click();
  await expect(manager.getByRole("button", { name: "秋の京都の名前を変更" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("collection-manager.png"), animations: "disabled" });
  await manager.getByRole("button", { name: "閉じる", exact: true }).last().click();
  await expect(card.locator(".place-collections")).toContainText("秋の京都");
  await card.getByRole("button", { name: "リストを選ぶ", exact: true }).click();
  await expect(member.getByRole("checkbox", { name: "秋の京都" })).toBeChecked();
  await member.getByRole("checkbox", { name: "デート", exact: true }).uncheck();
  await member.getByRole("button", { name: "所属を保存", exact: true }).click();
  await expect(card.locator(".place-collections")).not.toContainText("デート");
  await page.getByRole("button", { name: "リスト管理", exact: true }).click();
  await manager.getByRole("button", { name: "秋の京都のリストを削除" }).click();
  await expect(manager.getByText("リストは元に戻せません。お店・メモ・訪問記録は残ります。")).toBeVisible();
  await manager.getByRole("button", { name: "リストを削除する", exact: true }).click();
  await expect(manager.getByRole("button", { name: "秋の京都の名前を変更" })).toHaveCount(0);
  await manager.getByRole("button", { name: "閉じる", exact: true }).last().click();
  await page.getByLabel("リスト", { exact: true }).selectOption("unfiled");
  await expect(page.getByRole("article", { name: "京都のお気に入り", exact: true })).toContainText("窓際に座りたい");
  await page.reload();
  await expect(page.getByRole("article", { name: "京都のお気に入り", exact: true })).toBeVisible();
  const database = db();
  const { uid } = await getAuth(getApps()[0]).getUserByEmail(email);
  expect((await database.collection(`users/${uid}/savedPlaces`).get()).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("リストの読み込み失敗を再試行し、別画面の所属変更を上書きしない", async ({ page }, info) => {
  const email = `list-conflict-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  const database = db(), { uid } = await getAuth(getApps()[0]).getUserByEmail(email);
  const [place] = listFixtures(1), a = randomUUID(), b = randomUUID();
  await database.doc(`users/${uid}/savedPlaces/${place.id}`).set({ ...place, listIds: [a] });
  await database.doc(`users/${uid}/settings/placeLists`).set({ items: [a, b].map((id, i) => ({ id, name: i ? "旅行" : "仕事帰り", createdAt: Date.now(), updatedAt: Date.now() })) });
  await page.reload();
  let fail = true;
  await page.route("**/api/places/lists?place=*", route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: "一時的に接続できません。" } }); }
    return route.continue();
  });
  await page.getByRole("article").getByRole("button", { name: "リストを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "所属リストを選ぶ" });
  await expect(dialog.getByRole("alert")).toContainText("一時的に接続できません。");
  await expect(dialog.getByRole("button", { name: "所属を保存", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "リストを読み直す" }).click();
  await expect(dialog.getByRole("checkbox", { name: "仕事帰り" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "旅行", exact: true }).check();
  await page.route(/\/api\/places\/lists$/, route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "リスト作成に失敗しました。" } }) : route.continue());
  await dialog.getByRole("textbox", { name: "新しいリストを作成" }).fill("作成失敗のリスト");
  await dialog.getByRole("button", { name: "リストを作成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("リスト作成に失敗しました。");
  await expect(dialog.getByRole("checkbox", { name: "旅行", exact: true })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "所属を保存", exact: true })).toBeEnabled();
  await database.doc(`users/${uid}/savedPlaces/${place.id}`).update({ listIds: [b] });
  await dialog.getByRole("button", { name: "所属を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("別の画面で所属リストが変更されました。");
  expect((await database.doc(`users/${uid}/savedPlaces/${place.id}`).get()).get("listIds")).toEqual([b]);
  await dialog.getByRole("button", { name: "リストを読み直す" }).click();
  await expect(dialog.getByRole("checkbox", { name: "仕事帰り" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "旅行", exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("collection-membership.png"), animations: "disabled" });
  let failWrite = true;
  await page.route(`**/api/places/${place.id}`, async route => {
    if (failWrite && route.request().method() === "PATCH") {
      failWrite = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.fulfill({ status: 503, json: { error: "保存結果を確認できません。" } });
    } else await route.continue();
  });
  await dialog.getByRole("checkbox", { name: "仕事帰り" }).check();
  await dialog.getByRole("button", { name: "所属を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存結果を確認できません。");
  await expect(dialog.getByRole("checkbox", { name: "仕事帰り" })).toBeChecked();
  await dialog.getByRole("button", { name: "所属を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await database.doc(`users/${uid}/savedPlaces/${place.id}`).get()).get("listIds").sort()).toEqual([a, b].sort());
  await expect(page.getByRole("article").locator(".place-collections")).toContainText("旅行");
  await page.getByLabel("リスト", { exact: true }).selectOption(b);
  await expect(page.getByRole("article")).toHaveCount(1);
  await database.doc(`users/${uid}/savedPlaces/${place.id}`).update({ name: "更新されたカフェ" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("article", { name: "更新されたカフェ", exact: true })).toHaveCount(1);
  // 別端末で選択中のリストが削除されても、再読込から自動的に全件へ戻る。
  await database.doc(`users/${uid}/settings/placeLists`).set({ items: [] });
  await page.getByRole("search").getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByLabel("リスト", { exact: true })).toHaveValue("all");
  await expect(page.getByRole("article", { name: "更新されたカフェ", exact: true })).toHaveCount(1);
});

test("リスト名の変更後に届いた古い一覧応答を反映しない", async ({ page }, info) => {
  const email = `list-late-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await page.getByRole("button", { name: "リスト管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "リスト管理" });
  await manager.getByRole("textbox", { name: "新しいリストを作成" }).fill("変更前");
  await manager.getByRole("button", { name: "リストを作成", exact: true }).click();
  await expect(manager.getByRole("button", { name: "変更前の名前を変更" })).toBeVisible();
  await manager.getByRole("button", { name: "閉じる", exact: true }).last().click();
  let release: () => void = () => {}, delayed = false, fulfilled = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/places\/lists$/, async route => {
    if (route.request().method() !== "GET" || delayed) { await route.continue(); return; }
    delayed = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }); fulfilled = true;
  });
  await page.getByLabel("リスト", { exact: true }).focus();
  await expect.poll(() => delayed).toBe(true);
  await page.getByRole("button", { name: "リスト管理", exact: true }).click();
  await manager.getByRole("button", { name: "変更前の名前を変更" }).click();
  await manager.getByRole("textbox", { name: "新しいリスト名" }).fill("変更後");
  await manager.getByRole("button", { name: "名前を保存", exact: true }).click();
  await expect(manager.getByRole("button", { name: "変更後の名前を変更" })).toBeVisible();
  release(); await expect.poll(() => fulfilled).toBe(true);
  await manager.getByRole("button", { name: "閉じる", exact: true }).last().click();
  await expect(page.locator("#place-list-filter option").filter({ hasText: "変更後" })).toHaveCount(1);
  await expect(page.locator("#place-list-filter option").filter({ hasText: "変更前" })).toHaveCount(0);
});
