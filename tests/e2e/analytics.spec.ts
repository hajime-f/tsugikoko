import { expect, test, type Page } from "@playwright/test";
import { providerLogin } from "./helpers";

const commands = (page: Page) => page.evaluate(() => ((window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map(item => Array.from(item)));
const events = async (page: Page, name: string) => (await commands(page)).filter(item => item[0] === "event" && item[1] === name);

test.beforeEach(async ({ context, page }) => {
  // 実際のGA4・Google広告へ送信せず、アプリがキューへ渡す内容を検証する。
  await context.route(/https:\/\/[^/]*(?:googletagmanager|google-analytics)\.com\//, route => route.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route("**/api/milestones", route => route.fulfill({ json: { total: 0, pending: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, route => route.fulfill({ json: { items: [], nextCursor: null, generatedAt: null, mode: "insufficient", area: null } }));
});

test("GA4はURLの機密情報を除き、ページ遷移と初回登録だけを計測する", async ({ page }, info) => {
  const email = `analytics-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/login?secret=private-search#private-note");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  const setup = (await commands(page)).find(item => item[0] === "config" && item[1] === "G-TSUGIKOKOTEST");
  expect(setup?.[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  expect((await commands(page)).filter(item => item[0] === "config" && item[1] === "AW-18532065959")).toEqual([["config", "AW-18532065959"]]);
  expect((await commands(page)).filter(item => item[0] === "js")).toHaveLength(1);
  await expect(page.locator('head script[src*="googletagmanager.com/gtag/js"]')).toHaveCount(1);
  await expect(page.locator("head #tsugikoko-google-ads")).toHaveAttribute("src", "https://www.googletagmanager.com/gtag/js?id=AW-18532065959");
  expect((await events(page, "page_view"))[0][2]).toEqual({ page_location: "https://tsugikoko.com/login", page_title: "ログイン | ツギココ", page_referrer: "", send_to: "G-TSUGIKOKOTEST" });
  await page.evaluate(() => history.pushState({}, "", "?q=private-query#private-hash"));
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => events(page, "sign_up").then(items => items.length)).toBe(1);
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(2);
  expect((await events(page, "sign_up"))[0][2]).toMatchObject({ method: "Google", page_referrer: "" });
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await providerLogin(page, "Xの連携を追加", `x-${email}`);
  await expect(page.getByRole("status").filter({ hasText: "Xを同じアカウントに追加しました" })).toBeVisible();
  expect((await events(page, "sign_up")).length).toBe(1);
  const payload = JSON.stringify(await commands(page));
  for (const value of [email, "private-search", "private-note", "private-query", "private-hash", "テストユーザー", "user_id"]) expect(payload).not.toContain(value);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  expect((await events(page, "sign_up")).length).toBe(0);
});

test("GA4の停止設定は再読込後も有効で、解析を止めても登録できる", async ({ page, context }, info) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("test:analytics-initialized")) { localStorage.setItem("tsugikoko:analytics-disabled", "true"); sessionStorage.setItem("test:analytics-initialized", "1"); } });
  await page.goto("/");
  await page.getByRole("button", { name: "プライバシーについて" }).click();
  const dialog = page.getByRole("dialog");
  const checkbox = dialog.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" });
  await expect(checkbox).toBeChecked();
  expect((await commands(page)).filter(item => item[0] === "event" || (item[0] === "config" && item[1] === "G-TSUGIKOKOTEST"))).toHaveLength(0);
  expect((await commands(page)).filter(item => item[0] === "config")).toEqual([["config", "AW-18532065959"]]);
  await expect(page.locator("#tsugikoko-analytics")).toHaveCount(0);
  await checkbox.uncheck();
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  await expect(page.locator('head script[src*="googletagmanager.com/gtag/js"]')).toHaveCount(1);
  const other = await context.newPage();
  await other.goto("/");
  await expect.poll(() => events(other, "page_view").then(items => items.length)).toBe(1);
  await checkbox.check();
  await expect(dialog.getByRole("status")).toContainText("停止しました");
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)["ga-disable-G-TSUGIKOKOTEST"])).toBe(true);
  await expect.poll(() => other.evaluate(() => (window as unknown as Record<string, unknown>)["ga-disable-G-TSUGIKOKOTEST"])).toBe(true);
  await other.close();
  await page.screenshot({ path: info.outputPath("analytics-privacy.png") });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#tsugikoko-analytics")).toHaveCount(0);
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `analytics-off-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  expect((await commands(page)).filter(item => item[0] === "event" || (item[0] === "config" && item[1] === "G-TSUGIKOKOTEST"))).toHaveLength(0);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "利用状況の集計・アクセス解析" }).click();
  await expect(page.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" })).toBeChecked();
});

test("GA4タグの読み込み失敗でログインを失敗させない", async ({ page }, info) => {
  await page.route("https://www.googletagmanager.com/**", route => route.abort());
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `analytics-blocked-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  await expect(page.locator(".auth-error")).toHaveCount(0);
});
