import assert from "node:assert/strict";
import test from "node:test";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { categoryLabel } from "../src/categories.ts";
import {
  DATASET_ORDER,
  DATASET_PRESENTATION,
  TABLE_COLUMNS,
  companyLabel,
  rowId,
  rowText,
  visibleDatasets,
} from "../src/view-model.ts";

test("members see current company views while operators also see payouts and people", () => {
  const member = { user_id: "member-id", access_role: "company_member", company_id: "company-a" };
  const operator = { user_id: "operator-id", access_role: "operator", company_id: null };
  assert.deepEqual(visibleDatasets(member), ["live", "settlement", "data_kiosk", "fees"]);
  assert.deepEqual(visibleDatasets(operator), DATASET_ORDER);
});

test("every displayed sort uses a real allowed API column", () => {
  assert.deepEqual(Object.keys(DATASET_PRESENTATION), DATASET_ORDER);
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
});

test("row selection uses source-qualified IDs and each other view's stable identity", () => {
  assert.notEqual(
    rowId({ source: "SETTLEMENT", source_row_id: "shared-id" }),
    rowId({ source: "DATA_KIOSK", source_row_id: "shared-id" }),
  );
  assert.equal(rowId({ id: "source-fact" }), "source-fact");
  assert.equal(rowId({ fee_period_id: "fee-id" }), "fee-id");
  assert.equal(rowId({ user_id: "member-id" }), "member-id");
});

test("missing ownership and fee configuration do not become zero or an assigned company", () => {
  assert.equal(rowText({ fee_amount: null }, "fee_amount"), null);
  assert.equal(rowText({ fee_amount: "0" }, "fee_amount"), "0");
  assert.equal(companyLabel(null, new Map()), "Unassigned");
  assert.equal(companyLabel("company-a", new Map([["company-a", "Company A"]])), "Company A");
  assert.notEqual(categoryLabel("MISSING_FEE"), categoryLabel("NOT_APPLICABLE"));
  assert.notEqual(categoryLabel("MISSING_OWNERSHIP"), categoryLabel("APPLIED"));
});
