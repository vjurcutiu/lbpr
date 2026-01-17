import { test, expect } from "@playwright/test";

// NOTE: this file is intentionally skipped by default.
// Enable by changing test.skip -> test.describe (or removing the skip).

test.skip("auth smoke flows", () => {
  test("redirects to /login when visiting protected page logged-out", async ({ page }) => {
    await page.goto("/files");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });
});
