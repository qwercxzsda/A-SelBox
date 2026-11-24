import { expect, test } from "@playwright/test";

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
    route: "STORAGE",
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
      ? raw("finances", {
          id: args.p_row_id,
          version_id: args.p_version_id,
        })
      : [
          raw("finances", { is_current: "true" }),
          raw("finances", {
            id: "0198b50b-701a-7000-8000-000000000043",
            is_current: "false",
          }),
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
}

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
  await table.locator("tbody tr.inspectable-row").last().click();
  const detail = page.getByRole("dialog", { name: "Finances record details", exact: true });
  await expect(detail).toBeVisible();
  expect(requests.at(-1).args.p_row_id).toBe("0198b50b-701a-7000-8000-000000000043");
  await page.keyboard.press("Escape");
  await expect(lookup).toBeVisible();
  await lookup.getByRole("button", { name: "Close transaction lookup", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue("no matching main table SKU");
  expect(mainRequest().args).toEqual(mainScope);
});
