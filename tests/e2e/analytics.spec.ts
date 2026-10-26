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

test("GA4はURLの機密情報を除き、ページ遷移・認証開始・初回登録を区別する", async ({ page }, info) => {
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
  expect((await events(page, "login_start"))[0][2]).toMatchObject({ method: "Google", button_location: "login_page", auth_mode: "login", page_referrer: "" });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(2);
  expect((await events(page, "sign_up"))[0][2]).toMatchObject({ method: "Google", page_referrer: "" });
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await providerLogin(page, "Xの連携を追加", `x-${email}`);
  await expect(page.getByRole("status").filter({ hasText: "Xを同じアカウントに追加しました" })).toBeVisible();
  expect((await events(page, "sign_up")).length).toBe(1);
  expect((await events(page, "login_start")).length).toBe(1);
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
  await page.goto("/?utm_source=disabled_source&gclid=disabled_click#private-hash", { referer: "https://example.org/private?secret=1" });
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.getByRole("button", { name: "プライバシーについて" }).click();
  const dialog = page.getByRole("dialog");
  const checkbox = dialog.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" });
  await expect(checkbox).toBeChecked();
  expect((await commands(page)).filter(item => item[0] === "event" || (item[0] === "config" && item[1] === "G-TSUGIKOKOTEST"))).toHaveLength(0);
  expect((await commands(page)).filter(item => item[0] === "config")).toEqual([["config", "AW-18532065959"]]);
  await expect(page.locator("#tsugikoko-analytics")).toHaveCount(0);
  await checkbox.uncheck();
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
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

test("初回だけ許可した流入情報を送り、内部遷移と再読込では再送しない", async ({ page }) => {
  const query = "utm_source=google&utm_medium=cpc&utm_campaign=autumn_2026&utm_content=hero-a&utm_term=cafe&gclid=Test_Click-123";
  await page.goto(`/login?${query}&secret=private-search#private-note`, { referer: "https://www.google.com/search?q=private-query" });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toEqual({ page_location: `https://tsugikoko.com/login?${query}`, page_title: "ログイン | ツギココ", page_referrer: "https://www.google.com", send_to: "G-TSUGIKOKOTEST" });
  expect(JSON.stringify((await commands(page)).filter(item => item[0] === "set"))).not.toContain("utm_");
  await page.getByRole("link", { name: "トップページへ" }).click();
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(2);
  expect((await events(page, "page_view"))[1][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  expect((await events(page, "cta_click"))[0][2]).toMatchObject({ button_id: "header_login", page_location: "https://tsugikoko.com/", page_referrer: "" });
  const payload = JSON.stringify(await commands(page));
  for (const value of ["private-search", "private-note", "private-query"]) expect(payload).not.toContain(value);
  await page.goto(`/login?${query}`, { referer: "https://www.google.com/search?q=private-query" });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/login", page_referrer: "" });
  await page.reload();
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/login", page_referrer: "" });
});

test("流入値の機密情報・重複・長すぎる値を除外する", async ({ page }) => {
  const query = new URLSearchParams({ utm_source: "person@example.test", utm_medium: "https://private.test/path", utm_campaign: "a".repeat(65), utm_content: "name_090-1234-5678", utm_term: "私的な検索語", gclid: "g".repeat(257), q: "private-search" });
  await page.goto(`/?${query}#private-note`);
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
  await page.evaluate(() => sessionStorage.removeItem("tsugikoko:analytics-last-activity"));
  await page.goto("/?utm_source=google&utm_source=other&utm_medium=%250Asecret&utm_campaign=hello%0Aworld&utm_content=&utm_term=hello+world&gclid=090-1234-5678");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
  await page.evaluate(() => sessionStorage.removeItem("tsugikoko:analytics-last-activity"));
  await page.goto("/?utm_source=google%0A&gclid=Test_click%0A");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
});

test("内部サイトからの流入は参照元・UTMを送らず、30分後の外部流入は再計測する", async ({ page, baseURL }) => {
  await page.goto("/?utm_source=internal", { referer: `${baseURL}/privacy?secret=private` });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
  await page.evaluate(() => sessionStorage.setItem("tsugikoko:analytics-last-activity", String(Date.now() - 31 * 60 * 1000)));
  await page.goto("/?utm_source=newsletter", { referer: "https://example.org/private?query=secret" });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/?utm_source=newsletter", page_referrer: "https://example.org" });
});

test("保存・ヘッダー・ページ内のCTAは固定値だけを送る", async ({ page }, info) => {
  await page.goto("/");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  await expect(page.locator("#url-error")).toContainText("URLを入力");
  await page.getByLabel("気になるお店や投稿のURL").fill("https://example.com/private-store?email=person@example.test");
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const checks = [
    [page.getByRole("button", { name: "ログイン", exact: true }), "header_login"],
    [page.locator(".scene-bookmark").first(), "scene_signup"],
    [page.getByRole("button", { name: "自分だけのリストをつくる" }), "recommendation_signup"],
    [page.getByRole("button", { name: "行きたいリストをつくる", exact: true }), "footer_signup"],
  ] as const;
  for (const [button, id] of checks) {
    await button.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await events(page, "cta_click")).at(-1)?.[2]).toMatchObject({ button_id: id });
    await page.keyboard.press("Escape");
  }
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "はじめる", exact: true }).click();
    expect((await events(page, "cta_click")).at(-1)?.[2]).toMatchObject({ button_id: "menu_signup" });
  } else {
    await page.locator(".header-signup").click();
    expect((await events(page, "cta_click")).at(-1)?.[2]).toMatchObject({ button_id: "header_signup" });
  }
  expect((await events(page, "cta_click")).slice(0, 2).map(item => item[2])).toEqual([
    expect.objectContaining({ button_id: "hero_save" }), expect.objectContaining({ button_id: "hero_save" }),
  ]);
  expect(await events(page, "login_start")).toHaveLength(0);
  const payload = JSON.stringify(await commands(page));
  for (const secret of ["private-store", "person@example.test"]) expect(payload).not.toContain(secret);
});

for (const method of ["Google", "X", "Facebook", "Apple"]) {
  test(`${method}の認証開始を記録し、キャンセルを登録と数えない`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: `${method}でログイン`, exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL(/127\.0\.0\.1:9099/);
    expect((await events(page, "login_start"))[0][2]).toMatchObject({ method, button_location: "landing_dialog", auth_mode: "login", page_location: "https://tsugikoko.com/", page_referrer: "", send_to: "G-TSUGIKOKOTEST" });
    await popup.close();
    await expect(page.locator(".auth-error")).toContainText("キャンセル", { timeout: 15_000 });
    expect(await events(page, "sign_up")).toHaveLength(0);
  });
}

test("ログインページの登録切替と認証開始を区別する", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "初めての方はこちら" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Googleではじめる", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/127\.0\.0\.1:9099/);
  expect((await events(page, "login_start"))[0][2]).toMatchObject({ method: "Google", button_location: "login_page", auth_mode: "signup" });
  await popup.close();
  await expect(page.locator(".auth-error")).toContainText("キャンセル", { timeout: 15_000 });
  await page.getByRole("button", { name: "アカウントをお持ちの方はこちら" }).click();
  expect((await events(page, "cta_click")).map(item => item[2])).toEqual([
    expect.objectContaining({ button_id: "login_mode_signup" }), expect.objectContaining({ button_id: "login_mode_login" }),
  ]);
  expect(await events(page, "sign_up")).toHaveLength(0);
});

test("トップのスクロール到達率は段階ごとに1回だけ送る", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect(await events(page, "scroll_depth")).toHaveLength(0);
  for (const [index, percent] of [30, 55, 80, 95].entries()) {
    await page.evaluate(p => window.scrollTo({ top: document.documentElement.scrollHeight * p / 100 - window.innerHeight, behavior: "instant" }), percent);
    await expect.poll(() => events(page, "scroll_depth").then(items => items.length)).toBe(index + 1);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  expect((await events(page, "scroll_depth")).map(item => item[2])).toEqual([25, 50, 75, 90].map(percent => ({ percent_scrolled: percent, page_location: "https://tsugikoko.com/", page_title: "ツギココ", page_referrer: "", send_to: "G-TSUGIKOKOTEST" })));
});

test("計測処理が例外になってもボタン・認証は動作する", async ({ page }, info) => {
  await page.goto("/");
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  await page.evaluate(() => { (window as Window & { gtag?: () => void }).gtag = () => { throw new Error("tag failed"); }; });
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await providerLogin(page, "Googleでログイン", `analytics-throw-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
});

test("セッション保存が使えないときは流入情報を送らない", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); } }); });
  await page.goto("/?utm_source=google&gclid=Test_click", { referer: "https://example.org/private" });
  await expect.poll(() => events(page, "page_view").then(items => items.length)).toBe(1);
  expect((await events(page, "page_view"))[0][2]).toMatchObject({ page_location: "https://tsugikoko.com/", page_referrer: "" });
});
