import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { captureResponsiveReview, mockSupabase, signIn } from "./fixtures.mjs";
import { datasetRecord } from "../api-fixtures.mjs";
import { sourceLookup, sourceLookupTrigger } from "./financial-source-fixtures.mjs";
import { selectColumnOptions } from "./table-actions.mjs";
const rowId = "0198b50b-701a-7000-8000-000000000041";
const versionId = "0198b50b-701a-7000-8000-000000000042";
const native = "AMAZON-EXACT-LOOKUP";
const raw = (dataset, args = {}) =>
  datasetRecord(dataset, {
    id: rowId,
    version_id: versionId,
    sku: "EXACT-SOURCE-SKU",
    amount: "4.100000001",
    quantity: "1",
    fee_base: "4.100000001",
    currency: "USD",
    posted_date: "2026-07-15",
    activity_date: "2026-07-15",
    category: "DATA_KIOSK",
    component_type: "STORAGE_FEES",
    native_transaction_id: native,
    activity_eligible: "true",
    ...args,
  });
async function sourceRoutes(page, records = []) {
  await page.route("**/rest/v1/rpc/financial_source_*", async (route) => {
    const args = route.request().postDataJSON();
    records.push({ url: route.request().url(), args });
    const value = route.request().url().endsWith("financial_source_record")
      ? raw(args.p_source === "DATA_KIOSK" ? "data_kiosk" : "finances", {
          id: args.p_row_id,
          version_id: args.p_version_id,
        })
      : [
          raw("finances", { capture_status: "Current" }),
          raw("finances", {
            id: "0198b50b-701a-7000-8000-000000000043",
            capture_status: "Retained",
          }),
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
}

test("financial review opens the exact source version and restores nested detail after F5", async ({
  page,
}) => {
  const requests = [];
  await openFinancialReview(page, (fixture) => {
    fixture.financialReviewRecords.forEach((row, index) => {
      row.source_row_id = `0198b50b-701a-7000-8000-${String(index + 100).padStart(12, "0")}`;
      row.source_version_id = versionId;
    });
  });
  await sourceRoutes(page, requests);
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await monthly.getByRole("button", { name: "Source records", exact: true }).click();
  const source = monthly.getByRole("table", { name: "Source records", exact: true });
  await source.getByRole("button", { name: "View source record", exact: true }).first().click();
  const detail = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(
    detail.getByRole("heading", { name: "EXACT-SOURCE-SKU", exact: true }),
  ).toBeVisible();
  expect(requests.at(-1).args.p_version_id).toBe(versionId);
  const selected = requests.at(-1).args;
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Selected row details", exact: true }),
  ).toBeVisible();
  expect(requests.at(-1).args).toEqual(selected);
  await detail.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(monthly).toBeVisible();
  await expect(detail).toBeHidden();
});

test("fee family comparison pairs coupon charges and sponsored products advertising", async ({
  page,
}) => {
  await openFinancialReview(page, (fixture) => {
    const common = {
      month: "2026-07-01",
      category: "DATA_KIOSK",
      marketplace_name: "Amazon.com",
      currency: "USD",
      row_count: "1",
    };
    fixture.financialReviewTypeTotals = [
      { ...common, source: "FINANCES", component_type: "COUPON_FEES", amount: "-6.53" },
      { ...common, source: "DATA_KIOSK", component_type: "COUPON_PARTICIPATION_FEE", amount: "-5" },
      {
        ...common,
        source: "DATA_KIOSK",
        component_type: "COUPON_PERFORMANCE_FEE",
        amount: "-1.53",
      },
      { ...common, source: "FINANCES", component_type: "ADVERTISING", amount: "-100" },
      { ...common, source: "DATA_KIOSK", component_type: "SPONSORED_PRODUCTS", amount: "-90" },
    ];
  });
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  await page.getByRole("button", { name: "Fee family comparison", exact: true }).click();
  const table = page.getByRole("table", { name: "Fee family comparison", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const coupons = table
    .getByRole("row")
    .filter({ has: page.getByText("Coupons", { exact: true }) });
  await expect(coupons.locator("td:not(:first-child)")).toHaveText([
    "-6.53",
    "-6.53",
    "0.00",
    "Both sources",
  ]);
  const sponsored = table.getByRole("row").filter({
    has: page.getByText("Sponsored products", { exact: true }),
  });
  await expect(sponsored.locator("td:not(:first-child)")).toHaveText([
    "-100.00",
    "-90.00",
    "-10.00",
    "Both sources",
  ]);
  await expect(page.getByRole("table", { name: "Unpaired source types", exact: true })).toHaveCount(
    0,
  );
});

test("Finances provides an independent exact Amazon ID lookup with current and retained captures", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  const requests = [];
  await sourceRoutes(page, requests);
  await signIn(page);
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("no matching main table SKU");
  await selectColumnOptions(page, "Marketplace", ["Amazon.co.jp"]);
  const mainRequest = () => fixture.requests.findLast(({ dataset }) => dataset === "finances");
  await expect
    .poll(() => mainRequest()?.args)
    .toMatchObject({
      p_marketplaces: ["Amazon.co.jp"],
      p_search_skus: [],
      p_search_types: [],
    });
  const mainScope = mainRequest().args;
  await page.getByRole("button", { name: "Finances help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Finances help", exact: true });
  await expect(help).toContainText(
    "Find by transaction ID searches all retained captures, regardless of table filters.",
  );
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  const trigger = sourceLookupTrigger(page);
  await expect(sourceLookup(page)).toBeHidden();
  await captureResponsiveReview(page, testInfo, "finances-lookup-toolbar");
  await trigger.click();
  const lookup = sourceLookup(page);
  const transactionId = lookup.getByRole("textbox", {
    name: "Search Amazon transaction ID",
    exact: true,
  });
  await expect(transactionId).toBeFocused();
  await expect(transactionId).toHaveAttribute("placeholder", "Exact Amazon transaction ID");
  expect(
    await transactionId.evaluate((input) => [...input.labels].map((label) => label.textContent)),
  ).toEqual(["Search"]);
  await expect(lookup).not.toContainText(
    "Enter an exact Amazon transaction ID. Searches all retained captures; table filters do not apply.",
  );
  await transactionId.fill(native);
  await lookup.getByRole("button", { name: "Find transaction", exact: true }).click();
  const table = lookup.getByRole("table", { name: "Amazon transaction matches", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("Current");
  await expect(table).toContainText("Retained");
  expect(requests[0].args).toEqual({ p_native_transaction_id: native, p_limit: 26, p_offset: 0 });
  expect(mainRequest().args).toEqual(mainScope);
  await captureResponsiveReview(page, testInfo, "transaction-id-drawer");
  await table.getByRole("button", { name: "View source record", exact: true }).last().click();
  const detail = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(detail).toBeVisible();
  expect(requests.at(-1).args.p_row_id).toBe("0198b50b-701a-7000-8000-000000000043");
  await page.keyboard.press("Escape");
  await expect(lookup).toBeVisible();
  await lookup.getByRole("button", { name: "Close transaction lookup", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue("no matching main table SKU");
  expect(mainRequest().args).toEqual(mainScope);
});
