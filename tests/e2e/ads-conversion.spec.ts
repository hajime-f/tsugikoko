import { expect, test, type Page } from "@playwright/test";
import { providerLogin } from "./helpers";

const configured = process.env.E2E_ADS_SIGNUP === "1";
const commands = (page: Page) => page.evaluate(() => ((window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map(item => Array.from(item)));
const conversions = async (page: Page) => (await commands(page)).filter(item => item[0] === "event" && item[1] === "conversion");

test.beforeEach(async ({ context, page }) => {
  await context.route(/https:\/\/[^/]*(?:googletagmanager|google-analytics)\.com\//, route => route.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route(/https:\/\/[^/]*(?:doubleclick\.net|googleadservices\.com)\//, route => route.abort());
  await page.route("**/api/milestones", route => route.fulfill({ json: { total: 0, pending: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, route => route.fulfill({ json: { items: [], nextCursor: null, generatedAt: null, mode: "insufficient", area: null } }));
});

test("Google広告は新規登録だけ1回送り、連携・本人確認・復元・既存ログインでは送らない", async ({ page }, info) => {
  test.skip(!configured, "テスト用ラベルを設定したビルドで検証");
  const email = `ads-new-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login?secret=private-input#private-fragment");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => conversions(page).then(items => items.length)).toBe(1);
  const event = (await conversions(page))[0][2] as Record<string, string>;
  expect(event.send_to).toBe("AW-18532065959/TestSignupLabel123");
  expect(Object.keys(event).sort()).toEqual(["page_location", "page_referrer", "page_title", "send_to"]);
  expect(["https://tsugikoko.com/login", "https://tsugikoko.com/home"]).toContain(event.page_location);
  expect(event.page_referrer).toBe("");
  const payload = JSON.stringify(await conversions(page));
  for (const value of [email, "テストユーザー", "private-input", "private-fragment", "user_id", "transaction_id", "user_data"]) expect(payload).not.toContain(value);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await providerLogin(page, "Xの連携を追加", `x-${email}`);
  await expect(page.getByRole("status").filter({ hasText: "Xを同じアカウントに追加しました" })).toBeVisible();
  expect(await conversions(page)).toHaveLength(1);
  await page.getByRole("button", { name: "退会・データ削除", exact: true }).click();
  await providerLogin(page, "Googleで本人確認", email);
  await expect(page.getByText("本人確認が完了しました。")).toBeVisible();
  expect(await conversions(page)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "あなたのマイリスト", exact: true })).toBeVisible();
  expect(await conversions(page)).toHaveLength(0);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  expect(await conversions(page)).toHaveLength(0);
});

test("Google広告はラベル未設定なら新規登録でも送らない", async ({ page }, info) => {
  test.skip(configured, "ラベル未設定のビルドで検証");
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `ads-no-label-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => commands(page).then(items => items.filter(item => item[1] === "sign_up").length)).toBe(1);
  expect(await conversions(page)).toHaveLength(0);
});

test("Google広告は解析停止中の登録を送らず、再開しても遡って送らない", async ({ page }, info) => {
  test.skip(!configured, "テスト用ラベルを設定したビルドで検証");
  await page.addInitScript(() => localStorage.setItem("tsugikoko:analytics-disabled", "true"));
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `ads-disabled-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  expect(await conversions(page)).toHaveLength(0);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "利用状況の集計・アクセス解析" }).click();
  const check = page.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" });
  await expect(check).toBeChecked();
  await check.uncheck();
  await expect(page.getByRole("status").filter({ hasText: "再開しました" })).toBeVisible();
  expect(await conversions(page)).toHaveLength(0);
});

test("Google広告の送信処理が例外になっても登録は成功する", async ({ page }, info) => {
  test.skip(!configured, "テスト用ラベルを設定したビルドで検証");
  await page.goto("/login");
  await page.evaluate(() => {
    const target = window as Window & { gtag?: (...args: unknown[]) => void; adsAttempts?: number };
    const original = target.gtag;
    target.adsAttempts = 0;
    target.gtag = (...args) => {
      if (args[0] === "event" && args[1] === "conversion") { target.adsAttempts!++; throw new Error("Simulated advertising failure"); }
      original?.(...args);
    };
  });
  await providerLogin(page, "Googleでログイン", `ads-error-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { adsAttempts?: number }).adsAttempts)).toBe(1);
  expect(await conversions(page)).toHaveLength(0);
});
