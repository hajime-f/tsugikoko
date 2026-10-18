import { expect, test } from "@playwright/test";

import { providerLogin } from "./helpers";

test("未ログインの直接アクセスでは個人画面を表示しない", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "おかえりなさい。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeEnabled();
  await expect(page.getByText("あなた専用のホーム")).toHaveCount(0);
});

test("ログイン後にURLを自動保存し、再読込・別タブ・再登録でも重複しない", async ({ page, context, baseURL }, testInfo) => {
  const email = `flow-${testInfo.project.name}-${Date.now()}@example.test`;
  let saves = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/places" && request.method() === "POST") saves++; });
  await page.goto("/");
  await page.getByRole("textbox", { name: "気になるお店や投稿のURL" }).fill("https://example.com/cafe");
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  const photoURL = `${baseURL}/images/landing/coffee.webp`;
  await providerLogin(page, "Googleではじめる", email, photoURL);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("ログイン前のURLを「行きたい」に保存しました。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("登録するお店や投稿のURL")).toHaveValue("");
  expect(saves).toBe(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("tsugikoko:draft:")))).toEqual([]);
  await expect(page.getByText("こんにちは、テストユーザーさん。")).toBeVisible();
  const avatar = page.getByRole("button", { name: "アカウントを開く" }).getByRole("img", { name: "プロフィール写真" });
  await expect(avatar).toHaveAttribute("src", photoURL);
  await expect.poll(() => avatar.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  await expect.poll(() => avatar.evaluate((e) => {
    const rect = e.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  })).toEqual({ width: 38, height: 38 });
  await expect(page.getByText("https://example.com/cafe", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".member-hero-photo img").evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  await page.getByRole("tab", { name: "訪問済み" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("行きたいリストのお店から、訪問日や星の評価を残せます。");
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(saves).toBe(1);
  await expect(page.getByText("こんにちは、テストユーザーさん。")).toBeVisible();
  await expect(page.getByText("https://example.com/cafe", { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto(`${baseURL}/`);
  await expect(other).toHaveURL(/\/home$/);
  await expect(other.getByRole("article")).toHaveCount(1);
  await other.getByRole("button", { name: "アカウントを開く" }).click();
  await expect(other.getByRole("dialog")).toContainText(email);
  const profile = other.getByRole("dialog").getByRole("img", { name: "プロフィール写真" });
  await expect(profile).toHaveAttribute("src", photoURL);
  await expect.poll(() => profile.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  await expect.poll(() => profile.evaluate((e) => {
    const rect = e.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  })).toEqual({ width: 46, height: 46 });
  await expect(other.getByRole("button", { name: "Googleの連携を解除" })).toBeDisabled();
  await other.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(other).toHaveURL(`${baseURL}/`);
  await expect(page).toHaveURL(/\/login$/);
  const drafts = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("tsugikoko:draft:")));
  expect(drafts).toEqual([]);
  await other.goto(`${baseURL}/home`);
  await expect(other).toHaveURL(/\/login$/);
  await page.goto("/");
  await page.getByRole("textbox", { name: "気になるお店や投稿のURL" }).fill("https://example.com/cafe?utm_source=again");
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  await providerLogin(page, "Googleではじめる", email);
  await expect(page.getByText("このURLは登録済みです。保存済みのお店をご確認ください。", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(saves).toBe(2);
});

test("自動保存の応答が失敗してもURLを残し、再試行で重複を作らない", async ({ page }, testInfo) => {
  let saves = 0;
  await page.route("**/api/places", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    saves++;
    if (saves === 1) {
      // サーバーには保存されたが成功応答が届かなかった場合を再現する。
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.fulfill({ status: 503, json: { error: "保存結果を確認できませんでした。" } });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "気になるお店や投稿のURL" }).fill("https://example.com/retry-cafe");
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  await providerLogin(page, "Googleではじめる", `auto-retry-${testInfo.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("alert").filter({ hasText: "保存結果を確認できませんでした。" })).toContainText("URLは入力欄に残しています。");
  await expect(page.getByLabel("登録するお店や投稿のURL")).toHaveValue("https://example.com/retry-cafe");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("tsugikoko:draft:")).length)).toBe(1);
  expect(saves).toBe(1);
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await expect(page.getByText("このURLは登録済みです。保存済みのお店をご確認ください。", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("tsugikoko:draft:")))).toEqual([]);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(saves).toBe(2);
});

test("別プロバイダーの追加・解除でもユーザーIDが変わらない", async ({ page, request }, testInfo) => {
  const email = `link-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.goto("/login");
  await providerLogin(page, "Googleでログイン", email);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".account-trigger .user-avatar")).toHaveText("テ");
  const endpoint = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-tsugikoko/accounts:batchGet";
  const accounts = async () => {
    const response = await request.get(endpoint, { headers: { Authorization: "Bearer owner" } });
    expect(response.ok()).toBe(true);
    return (await response.json()).users;
  };
  const before = (await accounts()).find((u: { email: string }) => u.email === email);
  expect(before.localId).toBeTruthy();
  await page.getByRole("button", { name: "アカウントを開く" }).click();
  await providerLogin(page, "Facebookの連携を追加", `facebook-${email}`);
  await expect(page.getByRole("status").filter({ hasText: "Facebookを同じアカウントに追加しました" })).toBeVisible();
  const after = (await accounts()).find((u: { localId: string }) => u.localId === before.localId);
  expect(after.providerUserInfo.map((p: { providerId: string }) => p.providerId).sort()).toEqual(["facebook.com", "google.com"]);
  await page.getByRole("button", { name: "Facebookの連携を解除" }).click();
  await page.getByRole("button", { name: "連携を解除する", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "連携を解除しました。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleの連携を解除" })).toBeDisabled();
  const finalUser = (await accounts()).find((u: { localId: string }) => u.localId === before.localId);
  expect(finalUser.providerUserInfo.map((p: { providerId: string }) => p.providerId)).toEqual(["google.com"]);
});

test("ログインをキャンセルしたURLは保存せず、ログイン再試行後に保存する", async ({ page }, testInfo) => {
  let saves = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/places" && request.method() === "POST") saves++; });
  await page.goto("/");
  await page.getByRole("textbox", { name: "気になるお店や投稿のURL" }).fill("https://example.com/cancel-cafe");
  await page.getByRole("button", { name: "保存してはじめる" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Googleではじめる", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/127\.0\.0\.1:9099/);
  await popup.close();
  await expect(page.getByRole("alert").filter({ hasText: "ログインをキャンセルしました" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Googleではじめる", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/$/);
  expect(saves).toBe(0);
  await providerLogin(page, "Googleではじめる", `auto-cancel-${testInfo.project.name}-${Date.now()}@example.test`);
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(saves).toBe(1);
});
