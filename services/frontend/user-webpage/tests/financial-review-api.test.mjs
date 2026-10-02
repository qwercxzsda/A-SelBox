import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

test("financial review RPC projections align alphabetized CSV headers with exact field values", async () => {
  const totals = {
    month: "2026-07-01",
    category: "DATA_KIOSK",
    currency: "AUD",
    settlement_amount: "9007199254740993.123456789",
    data_kiosk_amount: "9007199254740993.123456790",
    difference: "-0.000000001",
    settlement_row_count: "55",
    data_kiosk_row_count: "31",
  };
  const type = {
    month: "2026-07-01",
    category: "DATA_KIOSK",
    currency: "AUD",
    source: "SETTLEMENT",
    component_type: "AmazonFees/Cost of Advertising/TransactionTotalAmount",
    amount: "-9007199254740993.123456789",
    row_count: "55",
  };
  const client = createApiClient(SETTINGS, async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/financial_review_records"))
      return new Response("activity_date\n");
    const record = parsed.pathname.endsWith("/financial_review_type_totals") ? type : totals;
    const selected = parsed.searchParams.get("select").split(",");
    // Match the deployed RPC serializer: header order and value order are calculated separately.
    const header = [...selected].sort().join(",");
    const values = selected.map((column) => `"${record[column].replaceAll('"', '""')}"`).join(",");
    return new Response(`${header}\n${values}`, { headers: { "Content-Range": "0-0/1" } });
  });
  const [total] = await client.fetchFinancialReviewTotals("access", "DATA_KIOSK", "2026-07");
  assert.deepEqual({ ...total }, totals);
  const months = await client.fetchFinancialReviewMonths(
    "access",
    "DATA_KIOSK",
    { month: "2026-07", offset: 0 },
    25,
    "",
  );
  assert.deepEqual({ ...months.rows[0] }, totals);
  const types = await client.fetchFinancialReviewTypes("access", "DATA_KIOSK", "2026-07", "AUD");
  assert.deepEqual({ ...types.rows[0] }, type);
});

test("financial review keeps category and month scope while aggregating every namespace and marketplace", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/rpc/financial_review_totals");
    assert.equal(parsed.searchParams.get("p_category"), "DATA_KIOSK");
    assert.equal(parsed.searchParams.get("p_month_from"), "2026-07-01");
    assert.equal(parsed.searchParams.get("p_month_to"), "2026-08-01");
    assert.equal(parsed.searchParams.get("order"), "currency.asc");
    for (const key of ["company_id", "sku", "seller_namespace", "marketplace_name", "currency"])
      assert.equal(parsed.searchParams.has(key), false);
    assert.equal(init.headers.Authorization, "Bearer access");
    assert.equal(init.headers.Accept, "text/csv");
    assert.equal(init.headers.Prefer, undefined);
    assert.equal(init.signal, controller.signal);
    return new Response(
      csvRecord({
        currency: "USD",
        settlement_amount: "9007199254740993.123456789",
        data_kiosk_amount: "9007199254740993.123456790",
        difference: "-0.000000001",
        settlement_row_count: "0",
        data_kiosk_row_count: "123456",
      }),
    );
  });
  const [row] = await client.fetchFinancialReviewTotals(
    "access",
    "DATA_KIOSK",
    "2026-07",
    controller.signal,
  );
  assert.equal(row.settlement_amount, "9007199254740993.123456789");
  assert.equal(row.data_kiosk_amount, "9007199254740993.123456790");
  assert.equal(row.difference, "-0.000000001");
  assert.equal(row.settlement_row_count, "0");
  assert.equal(row.data_kiosk_row_count, "123456");
});

function monthlyPageFixture(rows) {
  const requests = [];
  const sorted = [...rows].sort(
    (left, right) =>
      right.month.localeCompare(left.month) || left.currency.localeCompare(right.currency),
  );
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    requests.push({
      path: parsed.pathname,
      params: Object.fromEntries(params),
      signal: init.signal,
    });
    assert.equal(init.headers.Prefer, undefined);
    if (params.get("select") === "activity_date") {
      assert.equal(parsed.pathname, "/rest/v1/financial_review_records");
      assert.equal(params.get("category"), "eq.SETTLEMENT");
      assert.equal(params.get("limit"), "1");
      assert.equal(params.get("order"), "activity_date.desc");
      assert.equal(params.has("offset"), false);
      const before = params.get("activity_date")?.slice(3);
      const latest = sorted.find((row) => !before || row.month < before);
      return new Response(`activity_date\n${latest ? latest.month.replace(/01$/, "14") : ""}`);
    }
    assert.equal(parsed.pathname, "/rest/v1/rpc/financial_review_totals");
    assert.equal(params.get("p_category"), "SETTLEMENT");
    assert.equal(params.has("and"), false);
    assert.equal(params.get("order"), "month.desc,currency.asc");
    assert.ok(Number(params.get("limit")) <= 101);
    const from = params.get("p_month_from");
    const to = params.get("p_month_to");
    const offset = Number(params.get("offset"));
    const matching = sorted.filter((row) => row.month >= from && row.month < to);
    const page = matching.slice(offset, offset + Number(params.get("limit")));
    return new Response(
      `month,currency,difference\n${page.map((row) => `${row.month},${row.currency},${row.difference ?? "0"}`).join("\n")}`,
    );
  });
  return { client, requests, sorted };
}

function monthCurrencies(month, count) {
  return Array.from({ length: count }, (_, index) => ({
    month: `${month}-01`,
    currency: `A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    difference: index === 0 ? "0.000000001" : "0",
  }));
}

test("financial review row pages resume within a six-month window and fill across history gaps", async () => {
  const fixture = monthlyPageFixture([
    ...["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"].flatMap((month) =>
      monthCurrencies(month, 5),
    ),
    ...monthCurrencies("2024-01", 3),
  ]);
  const first = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    null,
    25,
    "",
  );
  assert.equal(first.rows.length, 25);
  assert.deepEqual(first.nextCursor, { month: "2026-10", offset: 25 });
  assert.equal(fixture.requests.length, 2, "a window with more rows needs no older-month probe");
  const second = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    first.nextCursor,
    25,
    "",
  );
  assert.equal(second.rows.length, 8);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.rows, ...second.rows].map((row) => ({ ...row })),
    fixture.sorted,
  );
  assert.deepEqual(
    fixture.requests
      .filter((request) => request.path.endsWith("financial_review_totals"))
      .map(({ params }) => [params.p_month_from, params.p_month_to, params.offset, params.limit]),
    [
      ["2026-05-01", "2026-11-01", "0", "26"],
      ["2026-05-01", "2026-11-01", "25", "26"],
      ["2023-08-01", "2024-02-01", "0", "21"],
    ],
  );
});

test("financial review full pages start the next older window without fetching unused totals", async () => {
  const fixture = monthlyPageFixture([
    ...["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"].flatMap((month) =>
      monthCurrencies(month, 5),
    ),
    ...monthCurrencies("2024-01", 4),
  ]);
  const first = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    null,
    25,
    "",
  );
  assert.deepEqual(first.nextCursor, { month: "2024-01", offset: 0 });
  assert.equal(
    fixture.requests.filter((request) => request.path.endsWith("financial_review_totals")).length,
    1,
  );
  const second = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    first.nextCursor,
    25,
    "",
  );
  assert.equal(second.rows.length, 4);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.rows, ...second.rows].map((row) => ({ ...row })),
    fixture.sorted,
  );
});

test("financial review month filtering paginates currency rows without probing other months", async () => {
  const controller = new AbortController();
  const fixture = monthlyPageFixture([
    ...monthCurrencies("2026-10", 3),
    ...monthCurrencies("2026-07", 31),
    ...monthCurrencies("2024-01", 3),
  ]);
  const first = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    null,
    25,
    "2026-07",
    controller.signal,
  );
  assert.equal(first.rows.length, 25);
  assert.deepEqual(first.nextCursor, { month: "2026-07", offset: 25 });
  const second = await fixture.client.fetchFinancialReviewMonths(
    "access",
    "SETTLEMENT",
    first.nextCursor,
    25,
    "2026-07",
    controller.signal,
  );
  assert.equal(second.rows.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.currency)).size, 31);
  assert.equal(fixture.requests.length, 2);
  for (const request of fixture.requests) {
    assert.equal(request.params.p_month_from, "2026-07-01");
    assert.equal(request.params.p_month_to, "2026-08-01");
    assert.equal(request.signal, controller.signal);
  }
});

test("financial review 25, 50, and 100 row pages end without an empty trailing page", async () => {
  for (const pageSize of [25, 50, 100]) {
    const fixture = monthlyPageFixture(monthCurrencies("2026-10", pageSize));
    const page = await fixture.client.fetchFinancialReviewMonths(
      "access",
      "SETTLEMENT",
      null,
      pageSize,
      "",
    );
    assert.equal(page.rows.length, pageSize);
    assert.equal(page.nextCursor, null);
    assert.equal(fixture.requests.length, 3);
    assert.equal(fixture.requests[1].params.limit, String(pageSize + 1));
  }
});

test("financial review type breakdown paginates both sources without merging raw types or rounding", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/rpc/financial_review_type_totals");
    assert.equal(params.get("p_category"), "SELBOX");
    assert.equal(params.get("p_month_from"), "2026-07-01");
    assert.equal(params.get("p_month_to"), "2026-08-01");
    assert.equal(params.get("p_currency"), "GBP");
    assert.equal(params.get("order"), "source.asc,component_type.asc");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "50");
    assert.equal(params.has("source"), false);
    assert.equal(init.headers.Prefer, "count=exact");
    return new Response(
      csvRecord({
        source: "SETTLEMENT",
        component_type: "AmazonFees/EPR/Base fee",
        amount: "-0.0000000001",
        row_count: "71",
      }),
      { headers: { "Content-Range": "50-50/51" } },
    );
  });
  const page = await client.fetchFinancialReviewTypes("access", "SELBOX", "2026-07", "GBP", 1);
  assert.equal(page.totalCount, 51);
  assert.equal(page.rows[0].amount, "-0.0000000001");
  assert.equal(page.rows[0].row_count, "71");
});

test("financial review records preserve matching source/type filters, provenance, and leap-month scope", async () => {
  const type = 'AmazonFees/EPR - GB, Packaging (2028)/Base "fee"';
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/financial_review_records");
    assert.equal(params.get("category"), "eq.SELBOX");
    assert.equal(params.get("currency"), "eq.GBP");
    assert.equal(params.get("and"), "(activity_date.gte.2028-02-01,activity_date.lte.2028-02-29)");
    assert.equal(params.has("month"), false);
    assert.equal(params.get("source"), "eq.SETTLEMENT");
    assert.equal(params.get("component_type"), `eq.${type}`);
    assert.equal(params.get("order"), "activity_date.desc,source.asc,source_row_id.asc");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "100");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.headers.Prefer, "count=exact");
    const columns = params.get("select").split(",");
    assert.ok(columns.includes("source_row_id"));
    assert.ok(columns.includes("source_version_id"));
    return new Response(
      csvRecord({
        source_row_id: "row-1",
        source_version_id: "version-1",
        component_type: type,
        sku: null,
        amount: "0",
      }),
      { headers: { "Content-Range": "100-100/101" } },
    );
  });
  const page = await client.fetchFinancialReviewRecords(
    "access",
    "SELBOX",
    "2028-02",
    "GBP",
    2,
    { source: "SETTLEMENT", type },
    controller.signal,
  );
  assert.equal(page.totalCount, 101);
  assert.equal(page.rows[0].source_row_id, "row-1");
  assert.equal(page.rows[0].source_version_id, "version-1");
  assert.equal(page.rows[0].component_type, type);
  assert.equal(page.rows[0].sku, null);
  assert.equal(page.rows[0].amount, "0");
});

test("financial review record filters can show all contributing rows without excluding zero amounts", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    for (const key of [
      "source",
      "component_type",
      "amount",
      "sku",
      "company_id",
      "seller_namespace",
      "marketplace_name",
    ])
      assert.equal(params.has(key), false);
    assert.equal(params.get("category"), "eq.SETTLEMENT");
    return new Response("amount\n0\n", { headers: { "Content-Range": "0-0/1" } });
  });
  assert.equal(
    (await client.fetchFinancialReviewRecords("access", "SETTLEMENT", "2026-07", "USD", 0)).rows[0]
      .amount,
    "0",
  );
});

test("financial review validates category, month, currency, source, type and pagination before querying", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests++;
    return new Response("month\n");
  });
  for (const category of ["ANALYSIS_ONLY", "", "SETTLEMENT,category.eq.SELBOX", null]) {
    await assert.rejects(client.fetchFinancialReviewMonths("access", category, null, 25, ""));
    await assert.rejects(client.fetchFinancialReviewTotals("access", category, "2026-07"));
    assert.throws(() => client.fetchFinancialReviewTypes("access", category, "2026-07", "USD"));
  }
  for (const month of ["2026-13", "2026-7", "2026-07-01", "0000-01", "2026-07,or=(id)"])
    await assert.rejects(client.fetchFinancialReviewTotals("access", "SETTLEMENT", month));
  for (const filterMonth of ["2026-13", "2026-7", "2026-07-01", "0000-01", null, undefined])
    await assert.rejects(
      client.fetchFinancialReviewMonths("access", "SETTLEMENT", null, 25, filterMonth),
    );
  for (const cursor of [
    undefined,
    "2026-07",
    [],
    {},
    { month: "2026-7", offset: 0 },
    { month: "2026-07", offset: -1 },
    { month: "2026-07", offset: 0.5 },
    { month: "2026-07", offset: null },
    { month: "2026-07", offset: Number.MAX_SAFE_INTEGER },
  ])
    await assert.rejects(client.fetchFinancialReviewMonths("access", "SETTLEMENT", cursor, 25, ""));
  await assert.rejects(
    client.fetchFinancialReviewMonths(
      "access",
      "SETTLEMENT",
      { month: "2026-06", offset: 0 },
      25,
      "2026-07",
    ),
  );
  for (const pageSize of [-1, 0, 0.5, 1000, Number.MAX_SAFE_INTEGER, undefined])
    await assert.rejects(
      client.fetchFinancialReviewMonths("access", "SETTLEMENT", null, pageSize, ""),
    );
  for (const currency of ["usd", "", "US", "USD,EUR"])
    assert.throws(() =>
      client.fetchFinancialReviewTypes("access", "SETTLEMENT", "2026-07", currency),
    );
  for (const page of [-1, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      client.fetchFinancialReviewRecords("access", "SETTLEMENT", "2026-07", "USD", page),
    );
  for (const filters of [{ source: "SELBOX" }, { type: "" }, { type: "hello\0world" }])
    assert.throws(() =>
      client.fetchFinancialReviewRecords("access", "SETTLEMENT", "2026-07", "USD", 0, filters),
    );
  assert.equal(requests, 0);
});

test("financial review empty categories end cleanly and malformed month cursors fail closed", async () => {
  let requests = 0;
  const empty = createApiClient(SETTINGS, async () => {
    requests++;
    return new Response("month\n");
  });
  assert.deepEqual(await empty.fetchFinancialReviewMonths("access", "SELBOX", null, 25, ""), {
    rows: [],
    nextCursor: null,
  });
  assert.equal(requests, 1);
  for (const date of ["2026-02-30", "2026-07-02", "not-a-date", "2026-04-01", "2026-11-01"]) {
    const invalid = createApiClient(
      SETTINGS,
      async () => new Response(`month,currency\n${date},USD`),
    );
    await assert.rejects(
      invalid.fetchFinancialReviewMonths(
        "access",
        "SETTLEMENT",
        { month: "2026-10", offset: 0 },
        25,
        "",
      ),
    );
  }
  for (const date of ["2026-02-30", "2026-07-02", "not-a-date", "2026-05-01"]) {
    const invalid = createApiClient(
      SETTINGS,
      async (url) =>
        new Response(
          new URL(url).searchParams.get("select") === "activity_date"
            ? `activity_date\n${date}`
            : "month,currency\n",
        ),
    );
    await assert.rejects(
      invalid.fetchFinancialReviewMonths(
        "access",
        "SETTLEMENT",
        { month: "2026-10", offset: 0 },
        25,
        "",
      ),
    );
  }
});

test("financial review refuses truncated monthly groups and preserves permission or cancellation errors", async () => {
  const capped = createApiClient(
    SETTINGS,
    async (url) =>
      new Response(
        new URL(url).searchParams.get("select") === "activity_date"
          ? "activity_date\n"
          : `month,currency\n${Array.from({ length: 1000 }, () => "2026-10-01,USD").join("\n")}`,
      ),
  );
  await assert.rejects(
    capped.fetchFinancialReviewMonths(
      "access",
      "SETTLEMENT",
      { month: "2026-10", offset: 0 },
      25,
      "",
    ),
    /too many monthly currencies/,
  );
  const denied = createApiClient(
    SETTINGS,
    async () => new Response("private server details", { status: 403 }),
  );
  await assert.rejects(
    denied.fetchFinancialReviewTotals("access", "SETTLEMENT", "2026-07"),
    (error) => error.status === 403 && !error.message.includes("private server details"),
  );
  const controller = new AbortController();
  controller.abort();
  const cancelled = createApiClient(SETTINGS, async (_url, init) => {
    init.signal.throwIfAborted();
  });
  await assert.rejects(
    cancelled.fetchFinancialReviewTotals("access", "SETTLEMENT", "2026-07", controller.signal),
    (error) => error.name === "AbortError",
  );
});
