import { expect, test } from "@playwright/test";
import { financesRow, kioskRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";

for (const tab of ["Transactions", "Finances", "Data Kiosk"]) {
  for (const action of ["Back to filters", "Next records"]) {
    test(`${tab} bottom ${action} returns keyboard focus to the visible controls`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 800 });
      const fixture = await mockSupabase(page);
      fixture.roles["member-a"] = "administrator";
      fixture.totalCount = 105;
      fixture.financesRows = Array.from({ length: 105 }, (_, index) => financesRow(index + 1));
      fixture.kioskRows = Array.from({ length: 105 }, (_, index) => kioskRow(index + 1, "10"));
      await signIn(page);
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.getByLabel("Rows", { exact: true }).selectOption("100");
      const rows = page
        .getByRole("table", { name: "Financial records", exact: true })
        .locator("tbody tr");
      await expect(rows).toHaveCount(100);
      const bottom = page.getByRole("navigation", {
        name: "Record navigation at bottom",
        exact: true,
      });
      await bottom.getByRole("button", { name: action, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(rows).toHaveCount(action === "Next records" ? 5 : 100);
      const controls = page.locator(".table-toolbar");
      await expect(controls).toBeFocused();
      await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeInViewport();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath("table-controls-after-bottom-navigation.png"),
        animations: "disabled",
      });
    });
  }
}

test("horizontal column navigation retains focus at both boundaries without repeating scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockSupabase(page);
  await signIn(page);
  const region = page.getByRole("region", { name: "Financial table", exact: true });
  const right = page.getByRole("button", { name: "Scroll table right", exact: true });
  const left = page.getByRole("button", { name: "Scroll table left", exact: true });
  await expect(right).toBeEnabled();
  await right.focus();
  while (
    (await region.evaluate(
      (element) => element.scrollWidth - element.clientWidth - element.scrollLeft,
    )) > 1
  ) {
    const previous = await region.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(previous);
  }
  await expect(right).toBeDisabled();
  await expect(right).toBeFocused();
  const last = await region.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("Enter");
  expect(await region.evaluate((element) => element.scrollLeft)).toBe(last);
  await page.keyboard.press("Shift+Tab");
  await expect(left).toBeFocused();
  while ((await region.evaluate((element) => element.scrollLeft)) > 1) {
    const previous = await region.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeLessThan(previous);
  }
  await expect(left).toBeDisabled();
  await expect(left).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(right).toBeFocused();
});

test("User access exposes account-specific table and region names", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await signIn(page);
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  const region = page.getByRole("region", { name: "Account table", exact: true });
  await expect(region.getByRole("table", { name: "User accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Financial records", exact: true })).toHaveCount(0);
});

for (const tab of ["Transactions", "Payout reports"]) {
  test(`${tab} count-only retry retains keyboard context after its action disappears`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    let countFailed = true;
    if (tab === "Transactions") fixture.countStatusForRequest = () => (countFailed ? 403 : 200);
    else {
      fixture.payoutRows = Array.from({ length: 30 }, (_, index) => ({
        id: `0198b50b-701a-7000-8000-${String(index + 1).padStart(12, "0")}`,
        company_id: `company-${String(index)}`,
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        created_at: "2026-09-27T00:00:00Z",
        currency: "USD",
        source_amount: "100",
        fee_amount: "-5",
        company_amount: "95",
      }));
      await page.route("**/rest/v1/latest_company_payout_reports**", (route) =>
        route.request().method() === "HEAD" && countFailed
          ? route.fulfill({ status: 403 })
          : route.fallback(),
      );
    }
    await signIn(page);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const retry = page.getByRole("button", { name: "Retry count", exact: true });
    await expect(retry).toBeVisible();
    const dataset = tab === "Transactions" ? "live" : "payouts";
    const rowReads = () => fixture.requests.filter((entry) => entry.dataset === dataset).length;
    const before = rowReads();
    await retry.focus();
    countFailed = false;
    await page.keyboard.press("Enter");
    await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0);
    await expect(page.locator(".table-toolbar")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
    expect(rowReads()).toBe(before);
  });
}
