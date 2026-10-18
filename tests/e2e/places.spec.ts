import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
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
  await expect(page.getByRole("heading", { name: "あなたのマイリスト", exact: true })).toBeInViewport();
  await expect(page.getByRole("tab", { name: "行きたい", exact: true })).toBeInViewport();
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
  const email = `places-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  await page.getByLabel("登録するお店や投稿のURL").fill(unsupported);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.getByRole("article", { name: "Instagramの保存URL" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("情報確認待ち");
  await expect(card.getByRole("link")).toHaveAttribute("href", unsupported);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${unsupported}?utm_source=test`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  await expect(page.getByText("このURLは登録済みです。保存済みのお店をご確認ください。")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("dialog").getByLabel("店名", { exact: true }).fill("次の休日のお店");
  await page.getByRole("dialog").getByLabel("自分用メモ").fill("窓際の席が気になる");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("article", { name: "次の休日のお店" })).toContainText("窓際の席が気になる");
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
  await db().doc(`placeSources/${createHash("sha256").update(official).digest("hex")}`).set({ name: "検証用ビストロ", address: "東京都渋谷区テスト1-2-3", genre: null, fetchedAt: Date.now(), provenance: { version: "json-ld-ai-v1", method: "json-ld-v1" } });
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

test("ジャンルごとの軽量画像を遅延読み込みし、不明な店舗は従来の装飾を表示する", async ({ page }, info) => {
  const { genres } = await import("../../src/lib/places/genres");
  const entries = Object.entries(genres);
  const places = listFixtures(entries.length + 1).map((place, index) => ({ ...place, name: entries[index] ? `画像テスト ${entries[index][1].label}` : "ジャンル不明の店", genre: entries[index]?.[0] ?? null }));
  await page.route("**/api/places?*", route => route.fulfill({ json: { places, nextCursor: null } }));
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `genre-images-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("article")).toHaveCount(entries.length + 1);
  for (const [, genre] of entries) {
    const card = page.getByRole("article", { name: `画像テスト ${genre.label}`, exact: true });
    await card.scrollIntoViewIfNeeded();
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
