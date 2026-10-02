import { test, expect } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { liveRow } from "./api-fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";

const reportId = "0198b50b-701a-7000-8000-000000000099";
const companyId = "0198b50b-701a-7000-8000-000000000001";

function rows() {
  return Array.from({ length: 55 }, (_, index) => ({
    ...liveRow("RELOAD", index, companyId),
    id: `row-${index}`,
    source_row_id: `row-${index}`,
    activity_date: "2026-06-30",
    source: "SETTLEMENT",
    component_type: "PRODUCT_SALES",
    source_amount: "1",
    fee_amount: "0",
    company_amount: "1",
    quantity: "1",
    report_id: reportId,
    authoritative: "true",
  }));
}

test("F5 restores the selected payout, type, record page, and marketplace section", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = companyId;
  fixture.companyNames[companyId] = "Reload Company";
  fixture.payoutRows = [
    {
      id: reportId,
      company_id: companyId,
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27",
      source_amount: "55",
      fee_amount: "0",
      company_amount: "55",
    },
  ];
  fixture.payoutComponents = rows();
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr[tabindex='0']")
    .first()
    .click();
  let drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await drawer.getByRole("button", { name: "Sales and refunds details", exact: true }).click();
  await drawer.getByRole("button", { name: "View Product sales records", exact: true }).click();
  await drawer.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 2",
  );
  await drawer.getByRole("button", { name: "Marketplace breakdown", exact: true }).click();
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("tab", { name: "Payout reports", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    drawer.getByRole("button", { name: "Sales and refunds details", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    drawer.getByRole("button", { name: "Marketplace breakdown", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 2",
  );
  await expect(
    drawer.getByRole("table", { name: "Amount records", exact: true }).locator("tbody tr"),
  ).toHaveCount(5);
  await drawer.getByRole("button", { name: "Show all records", exact: true }).click();
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 1",
  );
});

test("F5 restores an estimate drilldown and fetches current values for its saved scope", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = companyId;
  fixture.companyNames[companyId] = "Reload Company";
  fixture.liveRows = rows();
  fixture.aggregateRows = [summaryBucket("2026-06-30", "55", { rowCount: 55 })];
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "55", { rowCount: 55 })];
  await signIn(page);
  await applyDates(page, "2026-06-01", "2026-06-30");
  await page.getByRole("button", { name: "View Selected dates by type", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "Amounts by type", exact: true });
  await drawer.getByRole("button", { name: "Sales and refunds details", exact: true }).click();
  await drawer.getByRole("button", { name: "View Product sales records", exact: true }).click();
  await drawer.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 2",
  );
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "77", { rowCount: 55 })];
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Amounts by type", exact: true });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("region", { name: "Breakdown total", exact: true }).locator("dd"),
  ).toHaveText(["77 USD", "0 USD", "77 USD"]);
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 2",
  );
  await expect(
    drawer.getByRole("table", { name: "Amount records", exact: true }).locator("tbody tr"),
  ).toHaveCount(5);
  await expect(
    drawer.getByRole("button", { name: "Sales and refunds details", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const snapshots = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("aselbox.workspace."))
      .map(([, value]) => value)
      .join("\n"),
  );
  expect(snapshots).not.toContain("reportedAmount");
  expect(snapshots).not.toContain("source_amount");
  fixture.liveRows = fixture.liveRows.slice(0, 5);
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "5", { rowCount: 5 })];
  await page.reload();
  await expect(drawer.getByRole("region", { name: "Amount records", exact: true })).toContainText(
    "Page 1",
  );
  await expect(
    drawer.getByRole("table", { name: "Amount records", exact: true }).locator("tbody tr"),
  ).toHaveCount(5);
});
