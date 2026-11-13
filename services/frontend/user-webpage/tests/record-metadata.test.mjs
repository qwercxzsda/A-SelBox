import assert from "node:assert/strict";
import test from "node:test";
import { recordMetadata } from "../src/record-metadata.ts";

test("metadata presents UTC dates and booleans without altering exact identifiers or source codes", () => {
  assert.deepEqual(
    recordMetadata({
      source_row_id: " row-001 / Mixed ",
      sku_id: "SKU-ID",
      seller_namespace: "N1",
      created_at: "2026-11-12T09:30:00+09:00",
      activity_date: "2026-11-12",
      transaction_status: "DEFERRED_RELEASED",
      is_current: "true",
      fee_base: "1.005",
      company_id: null,
    }),
    [
      { field: "Source row ID", value: " row-001 / Mixed " },
      { field: "SKU ID", value: "SKU-ID" },
      { field: "Source namespace", value: "N1" },
      { field: "Created at", value: "2026-11-12 00:30:00 UTC" },
      { field: "Activity date", value: "2026-11-12" },
      { field: "Amazon transaction status", value: "DEFERRED_RELEASED" },
      { field: "Current version", value: "Yes" },
      { field: "Fee base", value: "1.01" },
      { field: "Company ID", value: null },
    ],
  );
});
