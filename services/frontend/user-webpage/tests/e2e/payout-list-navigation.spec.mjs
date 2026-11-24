import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

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
