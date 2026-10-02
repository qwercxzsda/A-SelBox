import assert from "node:assert/strict";
import test from "node:test";
import { DATASET_CONFIG, isTableDataset } from "../src/api/config.ts";
import { parseTotalCount } from "../src/api/content-range.ts";
import { parseCsv } from "../src/api/csv.ts";
import { mapDatasetRows } from "../src/api/row-mappers.ts";
import { buildSearchFilter } from "../src/api/search.ts";
import { datasetRecord } from "./api-fixtures.mjs";

test("datasets use current source, payout, and application-account APIs", () => {
  assert.deepEqual(Object.keys(DATASET_CONFIG), [
    "live",
    "settlement",
    "data_kiosk",
    "payouts",
    "accounts",
  ]);
  for (const dataset of ["live", "settlement", "data_kiosk"])
    assert.equal(Object.hasOwn(DATASET_CONFIG[dataset], "endpoint"), false);
  assert.equal(DATASET_CONFIG.payouts.endpoint, "latest_company_payout_reports");
  assert.equal(DATASET_CONFIG.accounts.endpoint, "app_accounts");
  assert.deepEqual(DATASET_CONFIG.live.idColumns, ["source", "source_row_id"]);
  assert.deepEqual(DATASET_CONFIG.accounts.idColumns, ["user_id"]);
});

test("search uses visible transaction text and excludes hidden or computed fields", () => {
  const nonTextColumns = new Set([
    "category",
    "access_role",
    "company_id",
    "source_row_id",
    "activity_date",
    "posted_date",
    "fee_rate_percent",
    "source_amount",
    "fee_amount",
    "company_amount",
  ]);
  for (const dataset of Object.keys(DATASET_CONFIG).filter(isTableDataset)) {
    const config = DATASET_CONFIG[dataset];
    for (const column of config.searchColumns)
      assert.equal(nonTextColumns.has(column), false, `${config.endpoint}: ${column}`);
    for (const column of config.idColumns)
      assert.ok(config.selectColumns.includes(column), `${config.endpoint}: ${column}`);
  }
  assert.deepEqual(DATASET_CONFIG.live.searchColumns, [
    "sku",
    "component_type",
    "source",
    "marketplace_name",
  ]);
  for (const dataset of ["settlement", "data_kiosk"])
    assert.deepEqual(DATASET_CONFIG[dataset].searchColumns, [
      "sku",
      "component_type",
      "marketplace_name",
    ]);
  assert.deepEqual(DATASET_CONFIG.accounts.searchColumns, []);
});

test("Content-Range supports successful, empty, unknown, and out-of-range counts", () => {
  assert.equal(parseTotalCount("0-24/129"), 129);
  assert.equal(parseTotalCount("*/0"), 0);
  assert.equal(parseTotalCount("*/10"), 10);
  assert.equal(parseTotalCount("0-24/*"), null);
  assert.equal(parseTotalCount(null), null);
  assert.throws(() => parseTotalCount("invalid"), /invalid Content-Range/);
  assert.throws(() => parseTotalCount("invalid/10"), /invalid Content-Range/);
  assert.throws(() => parseTotalCount("*/9007199254740992"), /exceeds JavaScript's safe range/);
});

test("CSV preserves exact decimals, quoted newlines, and Unicode SKU text", () => {
  const [record] = parseCsv(
    'source_row_id,source_amount,sku\r\nrow-1,12345678901234567890.12345678901234567890,"SKU_１,한국\nline"',
  );
  assert.equal(Object.getPrototypeOf(record), null);
  assert.deepEqual(
    { ...record },
    {
      source_row_id: "row-1",
      source_amount: "12345678901234567890.12345678901234567890",
      sku: "SKU_１,한국\nline",
    },
  );
});

test("CSV rejects duplicate headers and malformed quoted fields", () => {
  assert.throws(() => parseCsv("id,id\nfirst,second"), /duplicate headers/);
  assert.throws(() => parseCsv('id\n"unterminated'), /unterminated quoted field/);
  assert.throws(() => parseCsv('id\n"closed"unexpected'), /characters after a closing quote/);
});

test("empty CSV and nullable fees remain distinct from explicitly zero fees", () => {
  assert.deepEqual(parseCsv("\n"), []);
  assert.deepEqual(parseCsv("\r\n"), []);
  assert.deepEqual(
    parseCsv('id,fee_amount,sku\nunknown,,\nzero,0,""').map((record) => ({ ...record })),
    [
      { id: "unknown", fee_amount: null, sku: null },
      { id: "zero", fee_amount: "0", sku: "" },
    ],
  );
});

test("current row decoding preserves decimal text and nullable configuration", () => {
  const record = datasetRecord("live", {
    source: "SETTLEMENT",
    source_row_id: "row-1",
    source_amount: "12345678901234567890.123456789012345678901",
    company_id: null,
    fee_rate_percent: null,
    fee_amount: null,
    company_amount: null,
  });
  const [row] = mapDatasetRows("live", [record]);
  assert.equal(row.source_amount, record.source_amount);
  assert.equal(row.company_id, null);
  assert.equal(row.fee_amount, null);
  assert.equal(row.company_amount, null);
});

test("search quotes filter syntax while preserving literal SKU punctuation and Unicode", () => {
  for (const term of [
    "SKU_100%",
    "a.b*c+d?",
    'quoted"value,or(id.eq.1)',
    "path\\value",
    "ＳＫＵ－１",
  ]) {
    const filter = buildSearchFilter(["sku"], term);
    assert.ok(filter.startsWith("(sku.imatch."));
    const pattern = JSON.parse(filter.slice("(sku.imatch.".length, -1));
    const expression = new RegExp(pattern, "i");
    assert.equal(expression.test(term), true);
    assert.equal(expression.test("completely unrelated text"), false);
  }
  assert.equal(buildSearchFilter([], "SKU"), null);
  assert.equal(buildSearchFilter(["sku"], "   "), null);
});
