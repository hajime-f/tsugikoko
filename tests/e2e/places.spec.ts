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
    deleted: false, deleteAt: null, visibility: "private",
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
  await db().doc(`placeSources/${createHash("sha256").update(official).digest("hex")}`).set({ name: "検証用ビストロ", address: "東京都渋谷区テスト1-2-3", fetchedAt: Date.now(), provenance: { version: "json-ld-ai-v1", method: "json-ld-v1" } });
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
