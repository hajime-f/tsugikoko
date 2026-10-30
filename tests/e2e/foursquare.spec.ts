import { test, expect } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { providerLogin } from "./helpers";
import { fsqFixture, fsqFixtureUrl } from "../fixtures/foursquare";

test.beforeEach(async ({ page }) => {
  await page.route(/googletagmanager\.com|googleadservices\.com|doubleclick\.net/, route => route.fulfill({ body: "", contentType: "application/javascript" }));
  await page.route("**/api/milestones", route => route.fulfill({ json: { total: 0, pending: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, route => route.fulfill({ json: { items: [], nextCursor: null, mode: "insufficient" } }));
  await page.route("**/api/places/*/google-details", route => route.fulfill({ status: 503, json: { error: "Googleの表示情報はテストで取得しません。" } }));
});
test("再確認の失敗後に候補の入力だけを取り消し、本人の入力とメモを保存できる", async ({ page }, info) => {
  await page.goto("/login"); await providerLogin(page, "Googleでログイン", `fsq-failure-${info.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${fsqFixtureUrl}?case=failure${info.project.name}${Date.now()}`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("店名", { exact: true })).toHaveValue("検証寿司");
  await dialog.getByLabel("店名", { exact: true }).fill("本人の店名");
  await dialog.getByLabel("自分用メモ").fill("残すメモ");
  let rejected = false;
  await page.route(/\/api\/places\/[a-f0-9]{64}$/, route => {
    if (route.request().method() === "PATCH" && route.request().postDataJSON().foursquare) {
      rejected = true; return route.fulfill({ status: 503, json: { error: "候補の再確認に失敗しました。" } });
    }
    return route.continue();
  });
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("再確認に失敗"); expect(rejected).toBe(true);
  await dialog.getByRole("button", { name: "候補の入力を取り消して手入力に戻る", exact: true }).click();
  await expect(dialog.getByLabel("店名", { exact: true })).toHaveValue("本人の店名");
  await expect(dialog.getByLabel("住所", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("ジャンル", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("自分用メモ")).toHaveValue("残すメモ");
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "本人の店名", exact: true })).toBeVisible();
});
test("URL保存から自動入力、確認保存、検索、出典付き共有、取り消しまで通る", async ({ page }, info) => {
  const email = `fsq-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login"); await providerLogin(page, "Googleでログイン", email);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${fsqFixtureUrl}?case=${info.project.name}${Date.now()}`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("店名", { exact: true })).toHaveValue("検証寿司");
  await expect(dialog.getByLabel("住所", { exact: true })).toHaveValue("東京都渋谷区テスト町1-2-3");
  await expect(dialog.getByLabel("ジャンル", { exact: true })).toHaveValue("sushi");
  await expect(dialog).toContainText("支店名の表記が異なります");
  await dialog.getByLabel("自分用メモ").fill("自分だけのメモ");
  await page.screenshot({ path: `.agent-bridge/runtime/foursquare-input-${info.project.name}.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.getByRole("article", { name: "検証寿司", exact: true });
  await expect(card).toContainText("Foursquare OS Places");
  await page.reload(); await expect(card).toBeVisible();
  await card.getByRole("button", { name: "共有", exact: true }).click();
  await expect(page.getByLabel("投稿内容")).toHaveValue(/Foursquare OS Places/);
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await dialog.getByRole("button", { name: "入力補助で取り込んだ情報を元に戻す", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") throw Error("Emulator required");
  const app = getApps()[0] ?? initializeApp({ projectId: "demo-tsugikoko" });
  const { uid } = await getAuth(app).getUserByEmail(email);
  const records = await getFirestore(app).collection(`users/${uid}/savedPlaces`).get();
  expect(records.docs[0].data()).toMatchObject({ name: "", address: "", genre: null, note: "自分だけのメモ", foursquareSource: null });
});
test("遅れて届く候補で入力中の値を上書きせず、複数候補は選択まで入力しない", async ({ page }, info) => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const catalog = fsqFixture(), first = { ...catalog.rows[0], distance: 7, exact: false, warnings: [] };
  await page.route("**/api/places/*/foursquare", async route => {
    await pending;
    await route.fulfill({ json: { enabled: true, version: catalog.version, candidates: [first, { ...first, id: "222222222222222222222222", name: "別の候補" }], automatic: false, more: false } });
  });
  await page.goto("/login"); await providerLogin(page, "Googleでログイン", `fsq-late-${info.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("登録するお店や投稿のURL").fill(`${fsqFixtureUrl}?case=late${info.project.name}${Date.now()}`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("店名", { exact: true }).fill("入力中の店名");
  release();
  await expect(dialog.getByRole("button", { name: "このお店の情報を入力", exact: true })).toHaveCount(2);
  await expect(dialog.getByLabel("住所", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "このお店の情報を入力", exact: true }).first().click();
  await expect(dialog.getByLabel("店名", { exact: true })).toHaveValue("入力中の店名");
  await expect(dialog.getByLabel("住所", { exact: true })).toHaveValue(first.address);
});
