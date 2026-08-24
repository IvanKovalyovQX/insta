import { test, expect } from "@playwright/test";

test("insta", async ({ page, context }) => {
const session = process.env.SESSION || "";
await context.addCookies([
    {
      name: "sessionid",
      value: session , 
      url: "https://www.instagram.com/",
    },
  ]);
  await page.goto("https://www.instagram.com/creator.ai777/");
  const items = page.locator('[style="object-fit: cover;"]');
  await page.getByRole("link", { name: "About" }).hover();
  await page.waitForLoadState("networkidle");
  await expect(items.nth(0)).toBeVisible();

  const count = await items.count();
  console.log(`Found ${count} items`);

  for (let i = 0; i < count; i++) {
    await items.nth(i).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});
