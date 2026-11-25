import assert from "node:assert/strict";
import test from "node:test";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { humanizeCode } from "../src/categories.ts";
import { countLabel } from "../src/pagination.ts";
import { RAW_DATASETS } from "../src/raw-data-view.ts";
import { TABLE_COLUMNS, displayColumns } from "../src/table-columns.ts";
import {
  DATASET_ORDER,
  DATASET_PRESENTATION,
  companyLabel,
  rowId,
  visibleDatasets,
} from "../src/view-model.ts";

test("members see transactions, fees, and payouts while administrators retain all views", () => {
  const member = { user_id: "member-id", access_role: "member", company_id: "company-a" };
  const administrator = {
    user_id: "administrator-id",
    access_role: "administrator",
    company_id: null,
  };
  assert.deepEqual(visibleDatasets(member), ["live", "fees", "payouts"]);
  assert.deepEqual(visibleDatasets(administrator), DATASET_ORDER);
});

test("account role labels use the same terminology throughout the workspace", () => {
  assert.equal(humanizeCode("administrator"), "Administrator");
  assert.equal(humanizeCode("member"), "Member");
  assert.equal(humanizeCode("unassigned"), "Unassigned");
});

test("every list counts what one of its rows is, in Amazon's terms for Amazon's records", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(DATASET_PRESENTATION)
        .filter(([, presentation]) => "items" in presentation)
        .map(([dataset, { items }]) => [dataset, countLabel(1, items)]),
    ),
    {
      live: "1 transaction",
      finances: "1 breakdown",
      payouts: "1 latest report",
      accounts: "1 user",
      ad_invoices: "1 invoice",
      storage: "1 storage fee",
      aged_storage: "1 aged storage fee",
      removal_orders: "1 removal order line",
    },
  );
});

test("every displayed sort uses a real allowed API column", () => {
  assert.deepEqual(
    Object.keys(DATASET_PRESENTATION).sort(),
    [...DATASET_ORDER, ...RAW_DATASETS].sort(),
  );
  for (const [dataset, columns] of Object.entries(TABLE_COLUMNS)) {
    for (const column of columns) {
      if (column.sortable) {
        assert.ok(
          DATASET_CONFIG[dataset].sortColumns.includes(column.sortable),
          `${dataset}: ${column.sortable}`,
        );
      }
    }
  }
  assert.deepEqual(
    displayColumns("live", false)
      .filter((column) => column.sortable)
      .map((column) => column.key),
    ["activity_at", "source_amount"],
  );
});

test("row selection uses source-qualified IDs and each other view's stable identity", () => {
  assert.notEqual(
    rowId({ source: "FINANCES", source_row_id: "shared-id" }),
    rowId({ source: "STORAGE", source_row_id: "shared-id" }),
  );
  assert.equal(rowId({ id: "source-fact" }), "source-fact");
  assert.equal(rowId({ user_id: "member-id" }), "member-id");
});

test("missing ownership and fee configuration do not become zero or an assigned company", () => {
  assert.equal(companyLabel(null, new Map()), "Unassigned");
  assert.equal(companyLabel("company-a", new Map([["company-a", "Company A"]])), "Company A");
  assert.notEqual(humanizeCode("MISSING_FEE"), humanizeCode("NOT_APPLICABLE"));
  assert.notEqual(humanizeCode("MISSING_FEE"), humanizeCode("APPLIED"));
});

test("Raw data tables show Amazon's columns, exact amounts and earlier Finances versions", () => {
  const headers = (dataset) =>
    TABLE_COLUMNS[dataset].map(({ label, secondary }) =>
      secondary ? `${label} / ${secondary.label}` : label,
    );
  assert.deepEqual(headers("ad_invoices"), [
    "Invoice date",
    "Invoice ID",
    "Marketplace",
    "Billing period",
    "Status",
    "Lines",
    "Amount due / Tax due",
  ]);
  assert.deepEqual(headers("aged_storage"), [
    "Snapshot month",
    "Marketplace",
    "SKU (as printed)",
    "FNSKU",
    "ASIN",
    "Age tier",
    "Quantity charged",
    "Amount charged",
  ]);
  assert.deepEqual(headers("removal_orders"), [
    "Request date (UTC)",
    "Order ID",
    "Region",
    "Order type",
    "Order status",
    "SKU (as printed)",
    "FNSKU",
    "Disposition",
    "Requested quantity",
    "Removal fee",
  ]);
  assert.deepEqual(headers("storage"), [
    "Month of charge",
    "Marketplace",
    "FNSKU",
    "ASIN",
    "Fulfillment center",
    "Average quantity on hand",
    "Estimated monthly storage fee",
  ]);
  const note = (dataset, key, row) =>
    TABLE_COLUMNS[dataset].find((column) => column.key === key).note(row);
  const fee = { currency: "JPY", fee_amount: "55", base_amount: "50", tax_amount: "5" };
  for (const dataset of ["storage", "aged_storage", "removal_orders"])
    assert.equal(note(dataset, "fee_amount", fee), "Tax included: 5 JPY", dataset);
  assert.equal(
    note("removal_orders", "requested_quantity", { order_type: "Return", shipped_quantity: "4" }),
    "Shipped: 4",
  );
  for (const dataset of RAW_DATASETS) {
    assert.equal(
      TABLE_COLUMNS[dataset].some(({ key }) => key === "seller_namespace"),
      false,
      dataset,
    );
    for (const column of TABLE_COLUMNS[dataset].flatMap((c) => [c, c.secondary ?? c]))
      assert.notEqual(column.kind, "money", `${dataset}: ${column.key} hides sub-cent values`);
    assert.equal(
      displayColumns(dataset, true).find(({ sortable }) => sortable)?.key,
      DATASET_CONFIG[dataset].defaultSort.column,
    );
  }
  assert.equal(TABLE_COLUMNS.finances[0].note({ is_current: "false" }), "Earlier version");
  assert.equal(TABLE_COLUMNS.finances[0].note({ is_current: "true" }), null);
  assert.equal(rowId({ id: "report-row" }), "report-row");
});
