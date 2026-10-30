import { test, expect } from "@playwright/test";
import { providerLogin } from "./helpers";

const scriptUrl = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9669747563254817";
const script = "#tsugikoko-adsense";
const withSlot = process.env.E2E_ADSENSE_SLOT === "1";
test.beforeEach(async ({ context, page }) => {
  // 実広告を取得せず、読み込み済みJSが次の画面へ残っていないかも検証する。
  await context.route(/googletagmanager\.com|google-analytics\.com|doubleclick\.net|googleadservices\.com/, route => route.fulfill({ contentType: "text/javascript", body: "" }));
  await context.route("https://pagead2.googlesyndication.com/**", route => route.fulfill({ contentType: "text/javascript", body: `window.__testAdSenseRuntime = true;
    window.__adPushes = window.adsbygoogle || [];
    window.adsbygoogle = { push: value => window.__adPushes.push(value) };` }));
  await page.route("**/api/milestones", route => route.fulfill({ json: { total: 0, pending: null } }));
  await page.route(/\/api\/recommendations(?:\?|$)/, route => route.fulfill({ json: { items: [], nextCursor: null, mode: "insufficient" } }));
});

test("ads.txtと確認用メタタグを公開し、トップに広告コードを1回だけ読み込む", async ({ page, request }) => {
  const ads = await request.get("/ads.txt");
  expect(ads.status()).toBe(200); expect(ads.headers()["content-type"]).toContain("text/plain");
  expect(await ads.text()).toBe("google.com, pub-9669747563254817, DIRECT, f08c47fec0942fa0\n");
  let calls = 0; page.on("request", req => { if (req.url() === scriptUrl) calls++; });
  await page.goto("/");
  await expect(page.locator(script)).toHaveAttribute("src", scriptUrl);
  await expect(page.locator(script)).toHaveAttribute("async", "");
  await expect(page.locator(script)).toHaveAttribute("crossorigin", "anonymous");
  await expect(page.locator('meta[name="google-adsense-account"]')).toHaveAttribute("content", "ca-pub-9669747563254817");
  await page.locator('input[type="url"]').fill("https://example.com/");
  await page.getByRole("button", { name: "写真のクレジット", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(script)).toHaveCount(1);
  await expect.poll(() => calls).toBe(1);
});

test("広告を読み込んだトップから完全遷移し、URLの下書きと新規登録を維持する", async ({ page }, info) => {
  test.skip(withSlot, "このケースはマイリスト広告のID未設定を確認");
  let calls = 0; page.on("request", req => { if (req.url() === scriptUrl) calls++; });
  await page.goto("/");
  await page.waitForFunction(() => (window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime);
  const url = `https://www.instagram.com/p/adsense_${info.project.name}_${Date.now()}/`;
  await page.locator('input[type="url"]').fill(url);
  await page.getByRole("button", { name: "保存してはじめる", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?mode=signup$/);
  await expect(page.locator(".draft-url")).toHaveText(url);
  expect(await page.evaluate(() => Boolean((window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime))).toBe(false);
  await expect(page.locator(script)).toHaveCount(0);
  await providerLogin(page, "Googleではじめる", `adsense-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("article")).toContainText(url);
  await expect(page.locator(script)).toHaveCount(0);
  await page.goto("/"); // ログイン済みのトップへの直接アクセスでも読み込まない。
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => calls).toBe(1);
  await page.evaluate(() => { (window as Window & { __privateDocument?: boolean }).__privateDocument = true; });
  await page.getByRole("button", { name: "アカウントを開く", exact: true }).click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => calls).toBe(2);
  expect(await page.evaluate(() => Boolean((window as Window & { __privateDocument?: boolean }).__privateDocument))).toBe(false);
});

test("ログインからトップへ戻り、ブラウザーで戻っても広告が残らない", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "トップページへ", exact: true }).click();
  await page.waitForFunction(() => (window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime);
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(script)).toHaveCount(0);
  expect(await page.evaluate(() => Boolean((window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime))).toBe(false);
});

test("ログイン・規約・プライバシー・削除の画面は広告を読み込まない", async ({ page }) => {
  let calls = 0; page.on("request", req => { if (req.url() === scriptUrl) calls++; });
  for (const path of ["/login", "/privacy", "/terms", "/data-deletion", "/data-deletion?requested=1", "/home"]) {
    await page.goto(path);
    await expect(page.locator(script)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  expect(calls).toBe(0);
});

test("停止済みならトップでも広告を読まず、再開後も読み込みは1回だけ", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsugikoko:analytics-disabled", "true"));
  let calls = 0; page.on("request", req => { if (req.url() === scriptUrl) calls++; });
  await page.goto("/");
  await page.getByRole("button", { name: "プライバシーについて", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" });
  await expect(checkbox).toBeChecked();
  await expect(page.locator(script)).toHaveCount(0); expect(calls).toBe(0);
  await checkbox.uncheck(); // モーダルが開いている間は新しく広告を読み込まない。
  await expect(page.locator(script)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(script)).toHaveCount(1);
  await expect.poll(() => calls).toBe(1);
});

test("別タブで停止すると読み込み済みの広告実行環境も破棄する", async ({ context, page }) => {
  await page.goto("/#faq-title");
  await page.waitForFunction(() => (window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime);
  const settings = await context.newPage();
  await settings.goto("/privacy");
  await settings.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" }).check();
  await page.waitForFunction(() => !(window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime);
  await expect(page).toHaveURL(/\/#faq-title$/);
  await expect(page.locator(script)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("tsugikoko:analytics-disabled"))).toBe("true");
  expect(await page.evaluate(() => Boolean((window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime))).toBe(false);
  await settings.close();
});

test("広告の読み込みが失敗してもURLなしの登録へ進める", async ({ page }, info) => {
  await page.route("https://pagead2.googlesyndication.com/**", route => route.abort());
  await page.goto("/");
  await expect(page.locator(script)).toHaveCount(1);
  await page.getByRole("button", { name: "URLなしではじめる", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?mode=signup$/);
  await providerLogin(page, "Googleではじめる", `adsense-blocked-${info.project.name}-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのマイリスト" })).toBeVisible();
  await expect(page.locator(script)).toHaveCount(0);
});

test("マイリストの広告は保存後だけ表示し、操作時に枠を取り除いて二重要求しない", async ({ page }, info) => {
  test.skip(!withSlot, "テスト用広告ユニットIDがあるビルドで確認");
  let calls = 0; page.on("request", req => { if (req.url() === scriptUrl) calls++; });
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `mylist-ad-${info.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("heading", { name: "最初の「行きたい」を、ここに。" })).toBeVisible();
  await expect(page.locator(script)).toHaveCount(0);
  const ad = page.getByRole("complementary", { name: "広告", exact: true });
  await expect(ad).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("登録するお店や投稿のURL").fill(`https://www.instagram.com/p/mylist_ad_${info.project.name}_${Date.now()}_${i}/`);
    await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(i + 1);
  }
  await expect(ad).toBeVisible();
  await expect(page.locator(".saved-place-grid > :nth-child(3)")).toHaveClass("mylist-ad");
  await expect(ad.locator("ins")).toHaveAttribute("data-ad-slot", "1234567890");
  await expect(ad.locator("ins")).toHaveAttribute("data-ad-format", "fluid");
  await expect.poll(() => calls).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { __adPushes?: unknown[] }).__adPushes?.length)).toBe(1);
  expect(await page.evaluate(() => (window as Window & { __adPushes?: unknown[] }).__adPushes)).toEqual([{}]);
  expect(await ad.locator("ins").evaluate(node => node.outerHTML)).not.toContain("instagram");
  await ad.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.agent-bridge/runtime/adsense-mylist-${info.project.name}.png`, fullPage: true });
  const card = page.getByRole("article").first();
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await expect(page.locator(".mylist-ad")).toBeHidden();
  await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".mylist-ad")).toHaveCount(0);
  await card.getByRole("button", { name: /をごみ箱へ移す/ }).click();
  await expect(page.locator(".mylist-ad")).toBeHidden();
  await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await expect(page.locator(".mylist-ad")).toBeHidden();
  await page.getByRole("button", { name: "退会・データ削除", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".mylist-ad")).toBeHidden();
  await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".mylist-ad")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __adPushes?: unknown[] }).__adPushes?.length)).toBe(1);
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await page.getByRole("button", { name: "利用状況の集計・アクセス解析" }).click();
  await expect(page.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" })).not.toBeChecked();
  // 設定後はこのモーダル自体が完全再読込で消えるため、check()の事後検証は使わない。
  await page.getByRole("checkbox", { name: "このブラウザーでアクセス解析を停止する" }).click();
  await page.waitForFunction(() => !(window as Window & { __testAdSenseRuntime?: boolean }).__testAdSenseRuntime);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.locator(script)).toHaveCount(0);
  await expect(page.locator(".mylist-ad")).toBeHidden();
});

test("マイリストの広告エラーでも店舗の編集・保存を続けられる", async ({ page }, info) => {
  test.skip(!withSlot, "テスト用広告ユニットIDがあるビルドで確認");
  await page.route("https://pagead2.googlesyndication.com/**", route => route.fulfill({ contentType: "text/javascript", body: "window.adsbygoogle = { push() { throw new Error('mock ad blocked'); } };" }));
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", `mylist-block-${info.project.name}-${Date.now()}@example.test`);
  await page.evaluate(() => { Object.defineProperty(window, "adsbygoogle", { value: { push() { throw new Error("mock ad blocked"); } }, configurable: true }); });
  await page.getByLabel("登録するお店や投稿のURL").fill(`https://www.instagram.com/p/mylist_block_${info.project.name}_${Date.now()}/`);
  await page.getByRole("button", { name: "行きたいに保存", exact: true }).click();
  const card = page.getByRole("article");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("dialog").getByLabel("店名", { exact: true }).fill("広告エラーでも保存できる見本店");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(card.getByRole("heading")).toHaveText("広告エラーでも保存できる見本店");
});
