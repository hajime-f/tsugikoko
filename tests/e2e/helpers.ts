import type { Page } from "@playwright/test";

export async function providerLogin(page: Page, buttonName: string, email: string, photoURL = "") {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/127\.0\.0\.1:9099/);
  await popup.locator("#add-account-button").click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("テストユーザー");
  if (photoURL) await popup.locator("#profile-photo-input").fill(photoURL);
  const closed = popup.waitForEvent("close");
  await popup.locator("#sign-in").click();
  await closed;
}
