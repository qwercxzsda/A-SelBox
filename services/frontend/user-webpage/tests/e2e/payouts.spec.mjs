import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview } from "./fixtures.mjs";
import { applyReportMonth, selectColumnOptions } from "./table-actions.mjs";

const company = "0198b50b-701a-7000-8000-000000000001";
const report = "0198b50b-701a-7000-8000-000000000002";

for (const role of ["administrator", "member"]) {
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
    if (role === "administrator") await selectColumnOptions(page, "Company", ["Monthly Company"]);
    await expect(page.getByLabel("Report company")).toHaveCount(0);
    await applyReportMonth(page, "2026-07");
    await expect(page.getByText("No matching reports", { exact: true })).toBeVisible();
    await expect(page.getByText("This month is not mature yet.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /payout readiness/ })).toHaveCount(0);
    await applyReportMonth(page, "2026-06");
    await expect(page.getByRole("cell", { name: "95.00 USD", exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: "Financial records", exact: true })
        .getByText("Latest", { exact: true }),
    ).toBeVisible();
    expect(fixture.payoutReadinessRequests ?? []).toHaveLength(0);
    expect(fixture.events.some(({ endpoint }) => endpoint.endsWith("payout_report_policy"))).toBe(
      false,
    );
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
  fixture.payoutRecords = [
    {
      source_row_id: "a",
      report_id: report,
      authoritative: "true",
      activity_date: "2026-06-12",
      sku: "OWNED-SKU",
      component_type: "PRODUCT_SALES",
      source: "FINANCES",
      marketplace_name: "Amazon.com",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
    {
      source_row_id: "cost",
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
      source_row_id: "b",
      report_id: report,
      authoritative: "false",
      activity_date: "2026-06-12",
      sku: "OWNED-SKU",
      component_type: "NET_PRODUCT_SALES",
      source: "DATA_KIOSK",
      source_amount: "102",
    },
  ];
  fixture.payoutRecords.push(
    ...Array.from({ length: 48 }, (_, index) => ({
      source_row_id: `zero-${String(index)}`,
      report_id: report,
      authoritative: "true",
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
    })),
    {
      source_row_id: "outside-first-page",
      report_id: report,
      authoritative: "true",
      sku: "OUTSIDE-FIRST-PAGE",
      source_amount: "2",
      fee_amount: "0",
      company_amount: "2",
    },
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate payout reports" })).toHaveCount(0);
  await expect(page.getByLabel("Report company")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "999.00 USD", exact: true })).toHaveCount(0);
  await page.getByRole("cell", { name: "87.00 USD", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Payout report details", exact: true });
  await expect(drawer.locator(".detail-drawer-context")).toContainText("Amazon.com · USD");
  await expect(page.getByRole("table", { name: "Amount records", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Amount records", exact: true })
      .getByRole("cell", { name: "Data Kiosk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "OUTSIDE-FIRST-PAGE", exact: true })).toHaveCount(0);
  await captureResponsiveReview(page, testInfo, "payout-records");
  await expect(page.getByText("Seller reconciliation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
  await expect(page.getByText("Saved report source details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reconciliation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "102.00", exact: true })).toHaveCount(0);
  expect(
    fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/rpc/report_source_totals"),
  ).toBe(false);
  expect(fixture.payoutRecordRequests.every(({ authoritative }) => authoritative === "true")).toBe(
    true,
  );
});

test("administrator payout drawers contain only their payout amounts and records", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.payoutRows = [
    {
      id: report,
      company_id: company,
      seller_namespace: "seller-a",
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27",
      source_amount: "75",
      fee_amount: "-5",
      company_amount: "70",
    },
  ];

  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("cell", { name: "70.00 USD", exact: true }).click();
  expect(
    fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/rpc/report_source_totals"),
  ).toBe(false);
  const drawer = page.getByRole("dialog", { name: "Payout report details" });
  await expect(
    drawer.getByRole("button", { name: /Saved report source details|Account reconciliation/ }),
  ).toHaveCount(0);
  await expect(drawer.getByRole("table", { name: "Account reconciliation" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toBeVisible();
  expect(fixture.payoutRecordRequests.every(({ authoritative }) => authoritative === "true")).toBe(
    true,
  );
  await captureResponsiveReview(page, testInfo, "payout-only-details");
});
