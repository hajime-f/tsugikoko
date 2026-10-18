import { expect, test } from "@playwright/test";

test("トップページが表示され、画像・画面幅・実行時エラーに問題がない", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("気になったら、ツギココ。");
  await expect(page).toHaveTitle(/ツギココ/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tsugikoko.com");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://tsugikoko.com");
  const hero = page.locator(".hero-image");
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("URLを検証し、入力を保持したままログイン案内を開く", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "example.com") externalRequests.push(request.url());
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "気になるお店や投稿のURL" });
  const submit = page.getByRole("button", { name: "保存してはじめる" });
  await submit.click();
  await expect(page.locator("#url-error")).toContainText("URLを入力");
  await input.fill("javascript:alert(1)");
  await submit.click();
  await expect(page.locator("#url-error")).toContainText("https://");
  await input.fill("https://example.com/cafe");
  await submit.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("https://example.com/cafe");
  await expect(dialog).toContainText("ログインが完了すると、このURLを非公開のマイリストに自動で保存します");
  await expect(dialog.getByRole("button", { name: /Googleではじめる/ })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Xではじめる", exact: true })).toBeEnabled();
  for (const provider of ["Facebook", "Apple"]) {
    await expect(dialog.getByRole("button", { name: new RegExp(`${provider}ではじめる`) })).toBeDisabled();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(input).toHaveValue("https://example.com/cafe");
  expect(externalRequests).toEqual([]);
});

test("保存デモとFAQが動作する", async ({ page }) => {
  await page.goto("/");
  const save = page.getByRole("button", { name: "「行きたい」に追加してみる" });
  await save.click();
  await expect(page.getByRole("button", { name: "行きたいリストに追加済み" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "行きたいリストに追加済み" }).click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await page.getByText("保存したお店は、ほかの人に見えますか？", { exact: true }).click();
  await expect(page.locator("details[open]")).toContainText("あなたの記録は、はじめは非公開");
});

test("ナビゲーション・ログイン案内・写真クレジットが動作する", async ({ page }, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("link", { name: "使い方" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page).toHaveURL(/#how-it-works$/);
  }
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("おかえりなさい。");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "写真のクレジット" }).click();
  await expect(page.getByRole("dialog")).toContainText("保存デモのコーヒーも、同じご提供画像を使用しています");
  await expect(page.getByRole("dialog")).toContainText("コーヒー・サラダ・食事の写真は、ご提供画像を使用しています");
});
