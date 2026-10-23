import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";

function populateReports(fixture, month = "2026-06", currency) {
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  fixture.payoutRows = Array.from({ length: 55 }, (_, index) => {
    const companyId = `0198b50b-701a-7000-8000-${String(index + 1).padStart(12, "0")}`;
    fixture.companyNames[companyId] = `QA Company ${String(index + 1).padStart(2, "0")}`;
    return {
      id: `0198b50b-701a-7000-9000-${String(index + 1).padStart(12, "0")}`,
      company_id: companyId,
      currency: currency ?? (index % 2 ? "JPY" : "USD"),
      start_date: `${month}-01`,
      end_date: end.toISOString().slice(0, 10),
      created_at: "2026-09-27T13:20:10Z",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    };
  });
}

for (const width of [390, 1280]) {
  test(`long payout lists can be paged from the last report at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    populateReports(fixture);
    await signIn(page);
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    const rows = table.locator("tbody tr[tabindex='0']");
    await expect(rows).toHaveCount(25);
    await rows.last().scrollIntoViewIfNeeded();
    const bottom = page.getByRole("navigation", {
      name: "Payout report navigation at bottom",
      exact: true,
    });
    await expect(bottom).toBeVisible();
    await bottom.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`payout-bottom-navigation-${width}.png`),
      animations: "disabled",
    });
    await bottom.getByRole("button", { name: "Next reports", exact: true }).click();
    await expect(table.getByRole("cell", { name: "QA Company 26", exact: true })).toBeInViewport();
    await expect(
      page.getByRole("group", { name: "Payout report controls", exact: true }),
    ).toBeFocused();
    await bottom.getByRole("button", { name: "Previous reports", exact: true }).click();
    await expect(table.getByRole("cell", { name: "QA Company 01", exact: true })).toBeInViewport();
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
    expect(fixture.events.some(({ endpoint }) => endpoint.includes("generate"))).toBe(false);
  });
}

test("nested snapshot paging keeps its controls below the sticky review header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFinancialReview(page, (fixture) => {
    populateReports(fixture, "2026-07", "USD");
  });
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await drawer.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  const snapshots = drawer.getByRole("region", { name: "Saved report snapshots", exact: true });
  const table = snapshots.getByRole("table", { name: "Financial records", exact: true });
  await expect(table.locator("tbody tr[tabindex='0']")).toHaveCount(25);
  await snapshots.getByRole("button", { name: "Next reports", exact: true }).click();
  await expect(table).toContainText("QA Company 26");
  const controls = snapshots.getByRole("group", { name: "Payout report controls", exact: true });
  await expect(controls).toBeFocused();
  await expect
    .poll(async () => {
      const header = await drawer.locator(".ui-drawer-header").boundingBox();
      const toolbar = await controls.boundingBox();
      return toolbar.y - header.y - header.height;
    })
    .toBeGreaterThanOrEqual(0);
});
