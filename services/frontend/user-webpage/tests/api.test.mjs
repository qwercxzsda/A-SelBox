import assert from "node:assert/strict";
import test from "node:test";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { parseTotalCount } from "../src/api/content-range.ts";
import { parseCsv } from "../src/api/csv.ts";
import { mapDatasetRows } from "../src/api/row-mappers.ts";
import { sanitizeSearchTerm } from "../src/api/search.ts";

function datasetRecord(dataset, overrides = {}) {
  return Object.assign(
    Object.fromEntries(DATASET_CONFIG[dataset].selectColumns.map((column) => [column, column])),
    overrides,
  );
}

test("canonical dataset configuration contains no legacy read models", () => {
  assert.deepEqual(
    Object.values(DATASET_CONFIG).map(({ endpoint }) => endpoint),
    [
      "sku_economics_transactions",
      "account_level_settlement_transactions",
      "excluded_settlement_movements",
    ],
  );
});

test("Content-Range parsing supports successful and out-of-range PostgREST responses", () => {
  assert.equal(parseTotalCount("0-24/51"), 51);
  assert.equal(parseTotalCount("*/10"), 10);
  assert.equal(parseTotalCount("0-24/*"), null);
  assert.equal(parseTotalCount(null), null);
  assert.throws(() => parseTotalCount("invalid"), /invalid Content-Range/);
  assert.throws(() => parseTotalCount("*/9007199254740992"), /exceeds JavaScript's safe range/);
});

test("CSV parsing preserves exact decimals and quoted JSON as text", () => {
  const csv = [
    "id,settlement_amount,nullable_value,per_unit_breakdown",
    'row-1,12345678901234567890.12345678901234567890,,"[{""category_code"":""PRODUCT_SALES"",""unit_amount"":""0.12345678901234567890""}]"',
  ].join("\r\n");

  const [record] = parseCsv(csv);
  assert.equal(Object.getPrototypeOf(record), null);
  assert.deepEqual(
    { ...record },
    {
      id: "row-1",
      settlement_amount: "12345678901234567890.12345678901234567890",
      nullable_value: null,
      per_unit_breakdown:
        '[{"category_code":"PRODUCT_SALES","unit_amount":"0.12345678901234567890"}]',
    },
  );
});

test("CSV parsing rejects duplicate headers and malformed quoted fields", () => {
  assert.throws(() => parseCsv("id,id\nfirst,second"), /duplicate headers/);
  assert.throws(() => parseCsv('id\n"unterminated'), /unterminated quoted field/);
  assert.throws(() => parseCsv('id\n"closed"unexpected'), /characters after a closing quote/);
});

test("CSV parsing accepts PostgREST's newline-only empty result", () => {
  assert.deepEqual(parseCsv("\n"), []);
  assert.deepEqual(parseCsv("\r\n"), []);
});

test("CSV parsing distinguishes an empty string from SQL NULL", () => {
  assert.deepEqual(
    parseCsv('id,value\nnull-value,\nempty-string,""').map((record) => ({ ...record })),
    [
      { id: "null-value", value: null },
      { id: "empty-string", value: "" },
    ],
  );
});

test("search sanitization removes PostgREST filter and wildcard syntax", () => {
  assert.equal(sanitizeSearchTerm('  SKU_100%.*,()\\"  '), "SKU 100");
  assert.equal(sanitizeSearchTerm("ＳＫＵ－１"), "SKU-1");
});

test("canonical row mappers preserve nullable metrics and exact per-unit decimals", () => {
  const [sku] = mapDatasetRows("sku", [
    datasetRecord("sku", {
      order_id: null,
      per_unit_breakdown: JSON.stringify([
        {
          category_code: "PRODUCT_SALES",
          occurrence_count: "3.000000000000000000",
          unit_amount: "0.123456789012345678901",
          currency: "USD",
          source_system: "SETTLEMENT",
        },
      ]),
      sales_occurrence_count: null,
      return_occurrence_count: null,
      settlement_amount: "12345678901234567890.123456789012345678901",
    }),
  ]);

  assert.equal(sku.order_id, null);
  assert.equal(sku.sales_occurrence_count, null);
  assert.equal(sku.return_occurrence_count, null);
  assert.equal(sku.settlement_amount, "12345678901234567890.123456789012345678901");
  assert.deepEqual(sku.per_unit_breakdown, [
    {
      category_code: "PRODUCT_SALES",
      occurrence_count: "3.000000000000000000",
      unit_amount: "0.123456789012345678901",
      currency: "USD",
      source_system: "SETTLEMENT",
    },
  ]);
});

test("canonical row mappers cover account-level and excluded public views", () => {
  const [account] = mapDatasetRows("account", [
    datasetRecord("account", {
      company_id: null,
      category_code: "SUBSCRIPTION_FEES",
      difference_amount: "-0.000000000000000001",
    }),
  ]);
  const [excluded] = mapDatasetRows("excluded", [
    datasetRecord("excluded", {
      category_code: "PAYMENT_MOVEMENT",
      settlement_amount: "99999999999999999999.000000000000000001",
      unassigned_reason: null,
    }),
  ]);

  assert.equal(account.company_id, null);
  assert.equal(account.category_code, "SUBSCRIPTION_FEES");
  assert.equal(account.difference_amount, "-0.000000000000000001");
  assert.equal(excluded.category_code, "PAYMENT_MOVEMENT");
  assert.equal(excluded.settlement_amount, "99999999999999999999.000000000000000001");
  assert.equal(excluded.unassigned_reason, null);
});
