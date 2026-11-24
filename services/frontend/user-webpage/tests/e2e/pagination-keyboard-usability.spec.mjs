import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

test("keyboard pagination keeps its place while the next page loads", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 100;
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const next = page.getByRole("button", { name: "Next", exact: true });
  const release = deferred();
  const started = deferred();
  fixture.beforeDataset = async () => {
    started.resolve();
    await release.promise;
  };
  try {
    await next.focus();
    await page.keyboard.press("Enter");
    await started.promise;
    await expect(next).toBeDisabled();
    await expect(next).toBeFocused();
    const requestsWhileLoading = fixture.requests.length;
    await page.keyboard.press("Enter");
    expect(fixture.requests).toHaveLength(requestsWhileLoading);
    release.resolve();
    await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rowWithSku(page, "ALPHA-051")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(rowWithSku(page, "ALPHA-076")).toBeVisible();
    await expect(next).toBeFocused();
    await expect(next).toBeDisabled();
    const finalRequests = fixture.requests.length;
    await page.keyboard.press("Enter");
    expect(fixture.requests).toHaveLength(finalRequests);
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByLabel("Page number", { exact: true })).toBeFocused();
  } finally {
    release.resolve();
  }
});
