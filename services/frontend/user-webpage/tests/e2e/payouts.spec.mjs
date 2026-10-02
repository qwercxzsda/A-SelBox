import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview, deferred } from "./fixtures.mjs";
import { applyReportMonth, selectColumnOptions } from "./table-actions.mjs";

const company = "0198b50b-701a-7000-8000-000000000001";
const report = "0198b50b-701a-7000-8000-000000000002";

for (const role of ["operator", "company_member"]) {
  test(`${role} browses automatically generated reports without generation controls`, async ({
    page,
  }, testInfo) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.companyIds["member-a"] = company;
    fixture.companyIds["member-b"] = company;
    fixture.companyNames[company] = "Monthly Company";
    fixture.payoutRows = [
      {
        id: report,
        company_id: company,
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        source_amount: "100",
        fee_amount: "-5",
        company_amount: "95",
        created_at: "2026-09-27T00:00:00Z",
        currency: "USD",
      },
    ];
    await signIn(page);
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    if (role === "operator") await selectColumnOptions(page, "Company", ["Monthly Company"]);
    await expect(page.getByLabel("Report company")).toHaveCount(0);
    await applyReportMonth(page, "2026-07");
    await expect(page.getByText("This month is not mature yet.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Reports are generated automatically", { exact: false }),
    ).toBeVisible();
    await applyReportMonth(page, "2026-06");
    await expect(page.getByRole("cell", { name: "95 USD", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate|refresh|reload/i })).toHaveCount(0);
    expect(fixture.events.some(({ endpoint }) => endpoint.includes("generate"))).toBe(false);
    await captureResponsiveReview(page, testInfo, `${role}-payout-reports`);
  });
}

test("members see both company amount sources without supporting or account controls", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = company;
  fixture.companyNames[company] = "Monthly Company";
  fixture.payoutRows = [
    {
      id: report,
      company_id: company,
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27",
      source_amount: "92",
      fee_amount: "-5",
      company_amount: "87",
    },
    { id: "other-report", company_id: "company-member-b", currency: "USD", company_amount: "999" },
  ];
  fixture.payoutComponents = [
    {
      id: "a",
      report_id: report,
      authoritative: "true",
      activity_date: "2026-06-12",
      sku: "OWNED-SKU",
      component_type: "PRODUCT_SALES",
      source: "SETTLEMENT",
      marketplace_name: "Amazon.com",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
    {
      id: "cost",
      report_id: report,
      authoritative: "true",
      activity_date: "2026-06-12",
      sku: "OWNED-SKU",
      source: "DATA_KIOSK",
      component_type: "FBA_STORAGE_FEE",
      source_amount: "-10",
      fee_amount: "0",
      company_amount: "-10",
    },
    {
      id: "b",
      report_id: report,
      authoritative: "false",
      activity_date: "2026-06-12",
      sku: "OWNED-SKU",
      component_type: "NET_PRODUCT_SALES",
      source_amount: "102",
    },
  ];
  fixture.payoutComponents.push(
    ...Array.from({ length: 48 }, (_, index) => ({
      id: `zero-${String(index)}`,
      report_id: report,
      authoritative: "true",
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
    })),
    {
      id: "outside-first-page",
      report_id: report,
      authoritative: "true",
      sku: "OUTSIDE-FIRST-PAGE",
      source_amount: "2",
      fee_amount: "0",
      company_amount: "2",
    },
  );
  fixture.payoutMarketplaceTotals = [
    {
      report_id: report,
      marketplace_name: "Amazon.com",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
    {
      report_id: report,
      marketplace_name: null,
      source_amount: "-8",
      fee_amount: "0",
      company_amount: "-8",
    },
    {
      report_id: "other-report",
      marketplace_name: "Amazon.co.jp",
      source_amount: "999",
      fee_amount: "0",
      company_amount: "999",
    },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate payout reports" })).toHaveCount(0);
  await expect(page.getByLabel("Report company")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "999 USD", exact: true })).toHaveCount(0);
  await page.getByRole("cell", { name: "87 USD", exact: true }).click();
  await page.getByText("Marketplace breakdown", { exact: true }).first().click();
  const breakdown = page.getByRole("table", { name: "Payout marketplace breakdown" });
  await expect(breakdown).toBeVisible();
  await expect(breakdown.getByRole("columnheader", { name: "Company amount (USD)" })).toBeVisible();
  await expect(breakdown.getByRole("cell", { name: "Not specified", exact: true })).toBeVisible();
  await expect(breakdown.getByRole("cell", { name: "-8", exact: true })).toHaveCount(2);
  await expect(breakdown.getByRole("cell", { name: "999", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Amount records", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Amount records", exact: true })
      .getByRole("cell", { name: "Data Kiosk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "OUTSIDE-FIRST-PAGE", exact: true })).toHaveCount(0);
  await captureResponsiveReview(page, testInfo, "payout-marketplace-breakdown");
  await expect(page.getByText("Seller reconciliation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
  await expect(page.getByText("Saved source details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reconciliation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "102", exact: true })).toHaveCount(0);
  await expect(breakdown.getByRole("cell", { name: "102", exact: true })).toHaveCount(0);
  await expect(breakdown.getByRole("cell", { name: "-8", exact: true })).toHaveCount(2);
  expect(
    fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/payout_report_reconciliation"),
  ).toBe(false);
  expect(
    fixture.payoutComponentRequests.every(({ authoritative }) => authoritative === "true"),
  ).toBe(true);
});

test("marketplace breakdown loads independently and retries an error into an empty result", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = company;
  fixture.companyNames[company] = "Monthly Company";
  fixture.payoutRows = [{ id: report, company_id: company, currency: "USD", company_amount: "85" }];
  const pending = deferred();
  fixture.beforePayoutMarketplaceTotals = () => pending.promise;
  fixture.payoutMarketplaceTotalsStatus = 400;
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("cell", { name: "85 USD", exact: true }).click();
  await page.getByText("Marketplace breakdown", { exact: true }).first().click();
  await expect(page.getByText("Loading marketplace breakdown…", { exact: true })).toBeVisible();
  await expect(page.getByText("No records match this selection.").first()).toBeVisible();
  pending.resolve();
  await expect(page.getByRole("alert")).toContainText("Could not load marketplace breakdown.");
  fixture.payoutMarketplaceTotalsStatus = 0;
  await page.getByRole("button", { name: "Retry marketplace breakdown" }).click();
  await expect(page.getByText("No saved marketplace amounts.", { exact: true })).toBeVisible();
});

test("administrator payout drawers contain only their payout amounts and records", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.payoutRows = [
    {
      id: report,
      company_id: company,
      seller_namespace: "seller-a",
      reconciliation_count: "1",
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27",
      source_amount: "75",
      fee_amount: "-5",
      company_amount: "70",
    },
  ];
  fixture.payoutReconciliation = [
    {
      report_id: report,
      row_number: "1",
      seller_namespace: "seller-a",
      activity_date: "2026-06-12",
      marketplace_name: "Amazon.com",
      currency: "USD",
      settlement_category_amount: "100",
      selbox_category_amount: "-3",
      data_kiosk_settlement_control: "-20",
      data_kiosk_category_amount: "-25",
      difference: "5",
      settlement_total: "77",
      accounted_total: "77",
    },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("cell", { name: "70 USD", exact: true }).click();
  expect(
    fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/payout_report_reconciliation"),
  ).toBe(false);
  const drawer = page.getByRole("dialog", { name: "Selected row details" });
  await expect(
    drawer.getByRole("button", { name: /Saved source details|Saved account reconciliation/ }),
  ).toHaveCount(0);
  await expect(drawer.getByRole("table", { name: "Saved reconciliation" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toBeVisible();
  expect(
    fixture.payoutComponentRequests.every(({ authoritative }) => authoritative === "true"),
  ).toBe(true);
  await captureResponsiveReview(page, testInfo, "payout-only-details");
});
