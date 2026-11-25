import assert from "node:assert/strict";
import test from "node:test";
import { recordMetadata } from "../src/record-metadata.ts";

test("metadata labels carry UTC for timestamps and present booleans without altering exact identifiers or source codes", () => {
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
      currency: "USD",
      company_id: null,
    }),
    [
      { field: "Source row ID", value: " row-001 / Mixed " },
      { field: "SKU ID", value: "SKU-ID" },
      { field: "Seller account", value: "N1" },
      { field: "Created at (UTC)", value: "2026-11-12 00:30:00" },
      { field: "Activity date", value: "2026-11-12" },
      { field: "Amazon transaction status", value: "DEFERRED_RELEASED" },
      { field: "Current version", value: "Yes" },
      { field: "Fee base", value: "1.01 USD" },
      { field: "Currency", value: "USD" },
      { field: "Company ID", value: null },
    ],
  );
});

test("the SelBox group is named in SelBox's casing and shows its label, never an unknown code", () => {
  assert.deepEqual(recordMetadata({ selbox_group: "ACCOUNT_FEE" }), [
    { field: "SelBox group", value: "Account fees" },
  ]);
  assert.deepEqual(recordMetadata({ selbox_group: null }), [
    { field: "SelBox group", value: null },
  ]);
  assert.throws(() => recordMetadata({ selbox_group: "OTHER" }), /Unknown SelBox group: OTHER/);
});

test("Raw data metadata keeps every digit of the fee base, in the record's currency", () => {
  const row = { fee_base: "-0.0002", currency: "USD" };
  assert.deepEqual(recordMetadata(row, ["fee_base"], { exactAmounts: true }), [
    { field: "Fee base", value: "-0.0002 USD" },
  ]);
  assert.deepEqual(
    recordMetadata({ fee_base: "1000", currency: "JPY" }, ["fee_base"], { exactAmounts: true }),
    [{ field: "Fee base", value: "1,000 JPY" }],
  );
  assert.deepEqual(recordMetadata(row, ["fee_base"]), [{ field: "Fee base", value: "0.00 USD" }]);
});
