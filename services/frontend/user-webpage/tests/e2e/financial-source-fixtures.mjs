import { expect } from "@playwright/test";
import { datasetRecord } from "../api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";

export const transaction = "AMAZON-LONG-RETAINED-LOOKUP";
export const versionId = "0198b50b-701a-7000-8000-000000000042";
export const recordId = (index) =>
  `0198b50b-701a-7000-8000-${String(index + 100).padStart(12, "0")}`;
export const sourceDetail = (page) =>
  page.getByRole("dialog", { name: "Selected row details", exact: true });
export const sourceLookup = (page) =>
  page.getByRole("dialog", { name: "Find Amazon transaction", exact: true });
export const sourceLookupTrigger = (page) =>
  page.getByRole("button", { name: "Find by transaction ID…", exact: true });

function sourceRow(index = 0, nativeId = transaction) {
  return datasetRecord("finances", {
    id: recordId(index),
    version_id: versionId,
    sku: `RETAINED-${String(index).padStart(2, "0")}`,
    native_transaction_id: nativeId,
    is_current: index ? "false" : "true",
    activity_eligible: "true",
    amount: "4.10",
    quantity: "1",
    fee_base: "4.10",
    currency: "USD",
    posted_date: "2026-07-15",
    activity_date: "2026-07-15",
    marketplace_name: "Amazon.com",
    component_type: "STORAGE_FEES",
  });
}

export async function sourceRoutes(page, { count = 25, nativeId = transaction } = {}) {
  const state = {
    status: 200,
    missing: false,
    wait: null,
    requests: [],
    rows: Array.from({ length: count }, (_, index) => sourceRow(index, nativeId)),
  };
  await page.route("**/rest/v1/rpc/financial_source_*", async (route) => {
    const args = route.request().postDataJSON();
    state.requests.push(args);
    if (route.request().url().endsWith("financial_source_record")) {
      if (state.wait) await state.wait;
      return route.fulfill({
        status: state.status,
        contentType: "application/json",
        body: JSON.stringify(
          state.status !== 200
            ? { message: "Temporary source failure" }
            : state.missing
              ? null
              : {
                  ...(state.rows.find((row) => row.id === args.p_row_id) ?? sourceRow()),
                  id: args.p_row_id,
                  version_id: args.p_version_id,
                },
        ),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.rows.slice(args.p_offset, args.p_offset + args.p_limit)),
    });
  });
  return state;
}

export async function openSourceLookup(page, options = {}) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  const state = await sourceRoutes(page, options);
  options.configure?.(state);
  await signIn(page);
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  const trigger = sourceLookupTrigger(page);
  await trigger.click();
  const lookup = sourceLookup(page);
  await expect(lookup).toBeVisible();
  await lookup
    .getByRole("textbox", { name: "Search Amazon transaction ID", exact: true })
    .fill(options.nativeId ?? transaction);
  await lookup.getByRole("button", { name: "Find transaction", exact: true }).click();
  const table = lookup.getByRole("table", { name: "Amazon transaction matches", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(Math.min(options.count ?? 25, 25));
  return {
    fixture,
    state,
    lookup,
    trigger,
    table,
    opener: table.locator("tbody tr.inspectable-row").first(),
  };
}
