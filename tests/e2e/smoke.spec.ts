import { expect, test } from "@playwright/test";

test("Playwright harness launches across all three browsers", async ({ page }) => {
  await page.setContent("<html><head><title>iframebuffer smoke</title></head><body></body></html>");
  await expect(page).toHaveTitle("iframebuffer smoke");
});
