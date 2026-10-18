import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { providerLogin } from "./helpers";
import type { Recommendation } from "../../src/lib/recommendations/schema";

const candidates: Recommendation[] = Array.from({ length: 12 }, (_, index) => ({
  id: (index + 1).toString(16).padStart(64, "0"), name: `おすすめ寿司 ${index + 1}`, address: "東京都渋谷区テスト1-2-3",
  genre: "sushi", url: `https://example.com/restaurants/${index + 1}`, reason: index < 5 ? "similar_tastes" : "preferred_genre",
}));

test("おすすめを追加表示し、保存・興味なし・設定での解除を行う", async ({ page }, info) => {
  const saved: Recommendation[] = [], dismissed: Recommendation[] = [];
  let failNextPage = true, failSave = true;
  await page.route("**/api/places?*", route => route.fulfill({ json: { places: saved.map(item => ({ ...item, sourceUrls: [item.url], sourceLabel: "example.com", note: "", extraction: "ready", visitCount: 0, visibility: "private", createdAt: Date.now(), updatedAt: Date.now() })), nextCursor: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, async route => {
    const request = route.request(), params = new URL(request.url()).searchParams;
    if (request.method() === "POST") {
      const { action, id } = request.postDataJSON();
      const item = candidates.find(item => item.id === id)!;
      if (action === "save") {
        if (failSave) { failSave = false; await route.fulfill({ status: 503, json: { error: "保存に失敗しました。再度お試しください。" } }); return; }
        saved.push(item);
      }
      if (action === "dismiss") dismissed.push(item);
      if (action === "restore") dismissed.splice(dismissed.findIndex(item => item.id === id), 1);
      await route.fulfill({ json: action === "save" ? { place: item, duplicate: false } : { ok: true } }); return;
    }
    if (params.has("dismissed")) { await route.fulfill({ json: { items: dismissed, nextCursor: null } }); return; }
    if (params.has("cursor") && failNextPage) { failNextPage = false; await route.fulfill({ status: 503, json: { error: "おすすめの続きを読み込めませんでした。" } }); return; }
    const available = candidates.filter(item => !saved.includes(item) && !dismissed.includes(item));
    const offset = Number(params.get("cursor") ?? 0);
    await route.fulfill({ json: { items: available.slice(offset, offset + 10), nextCursor: offset + 10 < available.length ? String(offset + 10) : null, generatedAt: Date.now(), mode: "personalized" } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `recommendations-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeAttached();
  const section = page.locator("#for-you");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("article")).toHaveCount(10);
  await expect(section).toContainText("非公開の保存・評価もおすすめの計算に使います。");
  await expect(section.getByText("保存・評価の傾向が近い人から", { exact: true })).toHaveCount(5);
  await section.getByRole("button", { name: "おすすめをもっと見る" }).click();
  await expect(section.getByRole("alert")).toContainText("おすすめの続きを読み込めませんでした。");
  await expect(section.getByRole("article")).toHaveCount(10);
  await section.getByRole("button", { name: "もう一度読み込む" }).click();
  await expect(section.getByRole("article")).toHaveCount(12);
  const first = section.getByRole("article", { name: "おすすめ：おすすめ寿司 1", exact: true });
  await first.getByRole("button", { name: "行きたいに保存" }).click();
  await expect(section.getByRole("alert")).toContainText("保存に失敗しました");
  await expect(first).toBeAttached();
  await first.getByRole("button", { name: "行きたいに保存" }).click();
  await expect(first).toHaveCount(0);
  await expect(page.locator("#my-places").getByRole("article", { name: "おすすめ寿司 1", exact: true })).toBeAttached();
  const second = section.getByRole("article", { name: "おすすめ：おすすめ寿司 2", exact: true });
  await second.getByRole("button", { name: "興味なし" }).click();
  await expect(second).toHaveCount(0);
  await section.getByRole("button", { name: "おすすめ設定" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "おすすめ設定" })).toBeVisible();
  await expect(dialog).toContainText("おすすめ寿司 2");
  await dialog.getByRole("button", { name: "おすすめ寿司 2の興味なしを解除" }).click();
  await expect(dialog).toContainText("「興味なし」にしたお店はありません。");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(second).toBeAttached();
  await expect(first).toHaveCount(0);
  await section.getByRole("heading", { name: "あなたへのおすすめ", exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("recommendations.png"), animations: "disabled" });
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await dialog.getByRole("button", { name: "おすすめの利用方針・興味なしの管理" }).click();
  await expect(dialog.getByRole("heading", { name: "おすすめ設定" })).toBeVisible();
});

test("一時的な障害を再試行し、データ不足と人気の候補を区別して表示する", async ({ page }, info) => {
  let available = false, failFirst = true;
  await page.route("**/api/places?*", route => route.fulfill({ json: { places: [], nextCursor: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, async route => {
    if (failFirst) { failFirst = false; await route.fulfill({ status: 503, json: { error: "おすすめを準備しています。少し待ってからもう一度お試しください。" } }); return; }
    await route.fulfill({ json: { items: available ? [{ ...candidates[0], reason: "popular" }] : [], nextCursor: null, generatedAt: Date.now(), mode: available ? "fallback" : "insufficient" } });
  });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `recommendations-empty-${info.project.name}-${Date.now()}@example.test`);
  const section = page.locator("#for-you");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("alert")).toContainText("おすすめを準備しています。");
  await expect(section.getByText("今は表示できる候補がありません。", { exact: false })).toHaveCount(0);
  await section.getByRole("button", { name: "もう一度読み込む" }).click();
  await expect(section.getByText("今は表示できる候補がありません。", { exact: false })).toBeVisible();
  await expect(section.getByRole("article")).toHaveCount(0);
  available = true;
  await page.reload();
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("article")).toHaveCount(1);
  await expect(section.getByText("保存・評価の傾向が近い人から", { exact: true })).toHaveCount(0);
  await expect(section.getByText("保存・評価の傾向から", { exact: true })).toBeVisible();
});

// モックに加えて、別ユーザーの保存・評価から実APIを通って推薦・保存されることを確認する。
test("実APIで他ユーザーの保存から推薦し、個人の追記を漏らさず保存する", async ({ page, request }, info) => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Emulators required");
  const app = getApps()[0] ?? initializeApp({ projectId: "demo-tsugikoko" });
  const database = getFirestore(app);
  const suffix = `${info.project.name}-${Date.now()}`;
  const email = `real-recommendations-${suffix}@example.test`;
  let release: () => void = () => {};
  const prepared = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/recommendations(?:\?|$)/, async route => { await prepared; await route.continue(); });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeAttached();
  const owner = await getAuth(app).getUserByEmail(email);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const shared = ["共通の寿司", "共通のカフェ", "次の一軒"].map((name, index) => ({
    id: hash(`${suffix}-${index}`), name: `${name} ${suffix}`, address: "東京都港区テスト1-2-3", genre: "sushi",
    provenance: { url: `https://restaurant.example.com/${suffix}/${index}`, method: "json-ld-v1", version: "json-ld-v2", fetchedAt: Date.now() },
  }));
  const batch = database.batch();
  for (const place of shared) batch.set(database.doc(`places/${place.id}`), place);
  const peers = await Promise.all([0, 1, 2].map(index => getAuth(app).createUser({ email: `peer-${index}-${suffix}@example.test` })));
  for (const [userIndex, user] of [owner, ...peers].entries()) {
    for (const [index, place] of shared.entries()) {
      if (userIndex === 0 && index === 2) continue;
      const url = place.provenance.url;
      batch.set(database.doc(`users/${user.uid}/savedPlaces/${hash(url)}`), {
        id: hash(url), placeId: place.id, url, sourceUrls: [url], name: `PRIVATE_NAME_${userIndex}`, address: "PRIVATE_ADDRESS", note: "PRIVATE_NOTE",
        genre: "sushi", customDetails: true, editedFields: ["name", "address"], extraction: "ready", reason: null, sourceLabel: "restaurant.example.com",
        createdAt: Date.now(), updatedAt: Date.now(), fetchedAt: Date.now(), deleted: false, deleteAt: null, visibility: "private", visitCount: 1,
        latestVisit: { id: hash(`visit-${userIndex}-${index}`), rating: 5, visitedOn: "2026-01-01" },
      });
    }
  }
  await batch.commit();
  // 全体集計が先行テストで生成されていた場合に、新しく投入したエミュレーター内の資料で再集計する。
  await database.doc("recommendationModel/current").delete();
  const section = page.locator("#for-you");
  const apiResponse = page.waitForResponse(response => response.url().endsWith("/api/recommendations") && response.request().method() === "GET");
  release();
  await section.scrollIntoViewIfNeeded();
  const response = await apiResponse;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_NAME|PRIVATE_ADDRESS|PRIVATE_NOTE/);
  for (const peer of peers) expect(JSON.stringify(payload)).not.toContain(peer.uid);
  const card = section.getByRole("article", { name: `おすすめ：${shared[2].name}`, exact: true });
  await expect(card).toBeAttached();
  await expect(card).toContainText("保存・評価の傾向が近い人から");
  await card.getByRole("button", { name: "行きたいに保存" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("#my-places").getByRole("article", { name: shared[2].name, exact: true })).toBeAttached();
  const stored = await database.collection(`users/${owner.uid}/savedPlaces`).where("placeId", "==", shared[2].id).get();
  expect(stored.size).toBe(1);
  expect(stored.docs[0].get("note")).toBe("");
  expect(stored.docs[0].get("name")).toBe(shared[2].name);
  expect((await request.get("/api/recommendations")).status()).toBe(401);
  expect((await request.post("/api/recommendations", { data: { action: "save", id: shared[2].id } })).status()).toBe(401);
});
