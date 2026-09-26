import assert from "node:assert/strict";
import test from "node:test";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { humanizeCode } from "../src/categories.ts";
import {
  DATASET_ORDER,
  DATASET_PRESENTATION,
  TABLE_COLUMNS,
  companyLabel,
  displayColumns,
  rowId,
  visibleDatasets,
} from "../src/view-model.ts";

test("members see transactions and fees while administrators retain all views", () => {
  const member = { user_id: "member-id", access_role: "company_member", company_id: "company-a" };
  const operator = { user_id: "operator-id", access_role: "operator", company_id: null };
  assert.deepEqual(visibleDatasets(member), ["live", "fees"]);
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
  assert.deepEqual(
    displayColumns("live", false)
      .filter((column) => column.sortable)
      .map((column) => column.key),
    ["activity_date", "source_amount"],
  );
});

test("row selection uses source-qualified IDs and each other view's stable identity", () => {
  assert.notEqual(
    rowId({ source: "SETTLEMENT", source_row_id: "shared-id" }),
    rowId({ source: "DATA_KIOSK", source_row_id: "shared-id" }),
  );
  assert.equal(rowId({ id: "source-fact" }), "source-fact");
  assert.equal(rowId({ user_id: "member-id" }), "member-id");
});

test("missing ownership and fee configuration do not become zero or an assigned company", () => {
  assert.equal(companyLabel(null, new Map()), "Unassigned");
  assert.equal(companyLabel("company-a", new Map([["company-a", "Company A"]])), "Company A");
  assert.notEqual(humanizeCode("MISSING_FEE"), humanizeCode("NOT_APPLICABLE"));
  assert.notEqual(humanizeCode("MISSING_OWNERSHIP"), humanizeCode("APPLIED"));
});
