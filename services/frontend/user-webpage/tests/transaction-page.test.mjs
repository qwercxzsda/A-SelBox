import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { datasetRecord } from "./api-fixtures.mjs";

const SETTINGS = {
  supabaseUrl: "https://api.example.invalid",
  publishableKey: "sb_publishable_transaction_page_test",
};
const COMPANY_ID = "0198b50b-701a-7000-8000-000000000001";
const DECIMAL_COLUMNS = [
  "source_amount",
  "quantity",
  "fee_base",
  "fee_rate_percent",
  "fee_amount",
  "company_amount",
];
const EXACT_AMOUNT = "12345678901234567890.12345678901234567890";
const row = (overrides = {}) => ({
  ...Object.fromEntries(DATASET_CONFIG.live.selectColumns.map((column) => [column, column])),
  ...Object.fromEntries(DECIMAL_COLUMNS.map((column) => [column, EXACT_AMOUNT])),
  source: "SETTLEMENT",
  source_row_id: "row-1",
  ...overrides,
});
const request = (overrides = {}) => ({
  accessToken: "test-access",
  dataset: "live",
  pageIndex: 0,
  pageSize: 25,
  search: "",
  sort: { column: "activity_date", direction: "desc" },
  ...overrides,
});
const filters = (overrides = {}) => ({
  companyIds: [],
  dateFrom: "",
  dateTo: "",
  skus: [],
  marketplaces: [],
  sources: [],
  types: [],
  feeApplicability: [],
  ...overrides,
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("transaction pages use the authenticated REST function for both date directions", async () => {
  for (const direction of ["asc", "desc"]) {
    let sent;
    const signal = new AbortController().signal;
    const client = createApiClient(SETTINGS, async (url, init) => {
      sent = { url, init, args: JSON.parse(init.body) };
      return json({ rows: [row()], total_count: "129" });
    });
    const result = await client.fetchDatasetPage(
      request({
        search: " \n\t ",
        sort: { column: "activity_date", direction },
        pageIndex: 2,
        signal,
      }),
    );
    assert.equal(sent.url, `${SETTINGS.supabaseUrl}/rest/v1/rpc/transaction_page`);
    assert.equal(sent.init.method, "POST");
    assert.equal(sent.init.redirect, "error");
    assert.equal(sent.init.signal, signal);
    assert.equal(sent.init.headers.Authorization, "Bearer test-access");
    assert.equal(sent.init.headers.apikey, SETTINGS.publishableKey);
    assert.equal(sent.init.headers.Accept, "application/json");
    assert.equal(sent.init.headers["Content-Type"], "application/json");
    assert.equal(new Headers(sent.init.headers).has("Prefer"), false);
    assert.deepEqual(sent.args, {
      p_limit: 25,
      p_offset: 50,
      p_direction: direction,
      p_order_by: "date",
      p_search: null,
      p_date_from: null,
      p_date_to: null,
      p_company_ids: [],
      p_skus: [],
      p_marketplaces: [],
      p_sources: [],
      p_types: [],
      p_fee_applicable: null,
      p_include_count: true,
    });
    assert.equal(result.totalCount, 129);
    for (const field of DECIMAL_COLUMNS) assert.equal(result.rows[0][field], EXACT_AMOUNT);
  }
});

test("transaction page arrays preserve exact text and inclusive dates without filter syntax interpolation", async () => {
  let args;
  const selections = filters({
    companyIds: [COMPANY_ID, COMPANY_ID],
    dateFrom: "2024-02-29",
    dateTo: "2024-03-01",
    skus: ["SKU_100%", 'quoted"SKU', "path\\sku", "  spaced  ", "ＳＫＵ－１", "SKU_100%"],
    marketplaces: ["Amazon.com", "Amazon.co.jp"],
    sources: ["SETTLEMENT", "DATA_KIOSK"],
    types: ["PRODUCT_SALES", "FbaStorageFee"],
  });
  const client = createApiClient(SETTINGS, async (_url, init) => {
    args = JSON.parse(init.body);
    return json({ rows: [], total_count: "0" });
  });
  assert.deepEqual(await client.fetchDatasetPage(request({ filters: selections })), {
    rows: [],
    totalCount: 0,
  });
  assert.equal(args.p_date_from, selections.dateFrom);
  assert.equal(args.p_date_to, selections.dateTo);
  for (const [key, values] of Object.entries({
    p_company_ids: selections.companyIds,
    p_skus: selections.skus,
    p_marketplaces: selections.marketplaces,
    p_sources: selections.sources,
    p_types: selections.types,
  }))
    assert.deepEqual(args[key], [...new Set(values)]);
});

test("all three transaction tabs send raw amount ordering in both directions and preserve exact decimals", async () => {
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    for (const direction of ["asc", "desc"]) {
      const amountColumn = dataset === "live" ? "source_amount" : "amount";
      const record =
        dataset === "live"
          ? row()
          : datasetRecord(dataset, {
              amount: EXACT_AMOUNT,
              quantity: "9007199254740993.123456789",
              ...(dataset === "data_kiosk" ? { fee_base: null } : {}),
            });
      const client = createApiClient(SETTINGS, async (url, init) => {
        assert.equal(
          new URL(url).pathname,
          `/rest/v1/rpc/${dataset === "live" ? "transaction_page" : "source_transaction_page"}`,
        );
        assert.equal(init.method, "POST");
        assert.equal(init.headers.Accept, "application/json");
        const args = JSON.parse(init.body);
        assert.equal(args.p_order_by, "amount");
        assert.equal(args.p_direction, direction);
        assert.equal(args.p_offset, 25);
        assert.equal(args.p_include_count, false);
        assert.equal(args.p_date_from, "2026-09-01");
        assert.equal(args.p_date_to, "2026-09-20");
        assert.deepEqual(args.p_skus, ['SKU,\\"raw', "negative"]);
        assert.deepEqual(args.p_marketplaces, ["Amazon.com"]);
        assert.deepEqual(args.p_types, ["PRODUCT_SALES"]);
        if (dataset !== "live") {
          assert.equal(args.p_dataset, dataset);
          for (const field of ["p_company_ids", "p_sources", "p_fee_applicable"])
            assert.equal(Object.hasOwn(args, field), false);
        }
        return json({ rows: [record], total_count: null });
      });
      const result = await client.fetchDatasetPage(
        request({
          dataset,
          pageIndex: 1,
          sort: { column: amountColumn, direction },
          includeCount: false,
          filters: filters({
            dateFrom: "2026-09-01",
            dateTo: "2026-09-20",
            skus: ['SKU,\\"raw', "negative", "negative"],
            marketplaces: ["Amazon.com", "Amazon.com"],
            types: ["PRODUCT_SALES"],
          }),
        }),
      );
      assert.equal(result.rows[0][amountColumn], EXACT_AMOUNT);
      assert.equal(result.rows[0].quantity, record.quantity);
      assert.equal(result.totalCount, null);
    }
  }
});

test("source tabs use their date columns for date RPCs and reject lossy source amounts", async () => {
  for (const dataset of ["settlement", "data_kiosk"]) {
    for (const direction of ["asc", "desc"]) {
      const client = createApiClient(SETTINGS, async (_url, init) => {
        assert.equal(JSON.parse(init.body).p_order_by, "date");
        return json({ rows: [], total_count: "129" });
      });
      assert.equal(
        (
          await client.fetchDatasetPage(
            request({
              dataset,
              sort: { column: DATASET_CONFIG[dataset].dateColumn, direction },
            }),
          )
        ).totalCount,
        129,
      );
    }
    for (const field of ["amount", "quantity", ...(dataset === "data_kiosk" ? ["fee_base"] : [])]) {
      const client = createApiClient(SETTINGS, async () =>
        json({
          rows: [datasetRecord(dataset, { [field]: 1.25 })],
          total_count: "1",
        }),
      );
      await assert.rejects(
        client.fetchDatasetPage(request({ dataset, sort: DATASET_CONFIG[dataset].defaultSort })),
      );
    }
  }
});

test("derived amount ordering is rejected before HTTP on all transaction tabs", async () => {
  const client = createApiClient(SETTINGS, () =>
    assert.fail("Unsupported ordering must not request data"),
  );
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    for (const column of ["company_amount", "fee_amount", "fee_rate_percent"]) {
      await assert.rejects(
        client.fetchDatasetPage(request({ dataset, sort: { column, direction: "desc" } })),
        /Sort column is not allowed/,
      );
    }
  }
});

test("transaction pages preserve SQL null, empty text, zero decimals, and unknown counts", async () => {
  const record = row({
    sku: "",
    fee_base: null,
    fee_rate_percent: "0",
    fee_amount: "0",
    company_amount: null,
  });
  const client = createApiClient(SETTINGS, async (_url, init) => {
    assert.equal(JSON.parse(init.body).p_include_count, false);
    return json({ rows: [record], total_count: null });
  });
  const result = await client.fetchDatasetPage(request({ includeCount: false }));
  assert.equal(result.totalCount, null);
  assert.deepEqual({ ...result.rows[0] }, record);
});

test("empty and out-of-range transaction pages retain server counts", async () => {
  for (const total_count of ["0", "10"]) {
    const client = createApiClient(SETTINGS, async () => json({ rows: [], total_count }));
    assert.deepEqual(await client.fetchDatasetPage(request({ pageIndex: 9 })), {
      rows: [],
      totalCount: Number(total_count),
    });
  }
});

test("transaction page responses reject lossy numbers and malformed counts or rows", async () => {
  const missing = row();
  delete missing.sku;
  for (const body of [
    {},
    { rows: {}, total_count: "0" },
    { rows: [null], total_count: "1" },
    { rows: [missing], total_count: "1" },
    { rows: [row({ source_row_id: null })], total_count: "1" },
    ...DECIMAL_COLUMNS.map((column) => ({ rows: [row({ [column]: 1.25 })], total_count: "1" })),
    { rows: [row({ fee_base: false })], total_count: "1" },
    ...[0, undefined, "-1", "1.5", "9007199254740992", "NaN"].map((total_count) => ({
      rows: [],
      total_count,
    })),
  ]) {
    const client = createApiClient(SETTINGS, async () => json(body));
    await assert.rejects(client.fetchDatasetPage(request()));
  }
});

test("non-transaction datasets keep their existing CSV API", async () => {
  for (const dataset of ["fees", "payouts", "accounts"]) {
    const client = createApiClient(SETTINGS, async (url, init) => {
      assert.equal(new URL(url).pathname, `/rest/v1/${DATASET_CONFIG[dataset].endpoint}`);
      assert.equal(init.headers.Accept, "text/csv");
      assert.equal(init.body, undefined);
      return new Response("", { headers: { "Content-Range": "*/0" } });
    });
    assert.deepEqual(
      await client.fetchDatasetPage(
        request({ dataset, search: "USD", sort: DATASET_CONFIG[dataset].defaultSort }),
      ),
      { rows: [], totalCount: 0 },
    );
  }
});

test("failed transaction RPCs remain private errors without a second fallback request", async () => {
  for (const status of [400, 401, 403, 404, 503]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async () => {
      calls += 1;
      return json({ message: "private database detail" }, status);
    });
    await assert.rejects(client.fetchDatasetPage(request()), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private database detail"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});
