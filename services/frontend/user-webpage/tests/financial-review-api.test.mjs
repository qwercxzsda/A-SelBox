import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

test("type RPC projections align alphabetized CSV headers with exact field values", async () => {
  const type = {
    month: "2026-07-01",
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    currency: "AUD",
    source: "FINANCES",
    component_type: "ADVERTISING",
    amount: "-9007199254740993.123456789",
    row_count: "55",
  };
  const client = createApiClient(SETTINGS, async (url) => {
    const selected = new URL(url).searchParams.get("select").split(",");
    assert.deepEqual(selected, [...selected].sort());
    return new Response(
      selected.join(",") + "\n" + selected.map((key) => JSON.stringify(type[key])).join(","),
      { headers: { "Content-Range": "0-0/1" } },
    );
  });
  const page = await client.fetchFinancialReviewTypes(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "AUD",
    "Amazon.com",
  );
  assert.deepEqual({ ...page.rows[0] }, type);
});

test("bounds read only the first and last activity date across currencies without counts or history scans", async () => {
  const requests = [];
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    requests.push(Object.fromEntries(params));
    assert.equal(parsed.pathname, "/rest/v1/financial_review_records");
    assert.equal(params.get("category"), "eq.DATA_KIOSK");
    assert.equal(params.get("marketplace_name"), "eq.Amazon.com");
    assert.equal(params.get("select"), "activity_date");
    assert.equal(params.get("limit"), "1");
    assert.equal(params.has("currency"), false);
    assert.equal(params.has("offset"), false);
    assert.equal(init.headers.Prefer, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(
      "activity_date\n" +
        (params.get("order") === "activity_date.asc" ? "2024-02-29" : "2026-10-16"),
    );
  });
  assert.deepEqual(
    await client.fetchFinancialReviewBounds(
      "access",
      "DATA_KIOSK",
      "Amazon.com",
      controller.signal,
    ),
    {
      firstMonth: "2024-02",
      lastMonth: "2026-10",
    },
  );
  assert.deepEqual(requests.map(({ order }) => order).sort(), [
    "activity_date.asc",
    "activity_date.desc",
  ]);
});

test("type breakdown paginates both sources without merging types or rounding", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/rpc/financial_review_type_totals");
    assert.equal(params.get("p_category"), "SELBOX");
    assert.equal(params.get("p_marketplace"), "Amazon.com");
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
        source: "FINANCES",
        component_type: "EPR_FEES",
        amount: "-0.0000000001",
        row_count: "71",
      }),
      { headers: { "Content-Range": "50-50/51" } },
    );
  });
  const page = await client.fetchFinancialReviewTypes(
    "access",
    "SELBOX",
    "2026-07",
    "GBP",
    "Amazon.com",
    1,
  );
  assert.equal(page.totalCount, 51);
  assert.equal(page.rows[0].amount, "-0.0000000001");
  assert.equal(page.rows[0].row_count, "71");
});

test("record filters preserve provenance, zero amounts, and leap-month scope", async () => {
  const type = 'UNRECOGNIZED_FEE, (2028)/Base "fee"';
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/financial_review_records");
    assert.equal(params.get("category"), "eq.SELBOX");
    assert.equal(params.get("marketplace_name"), "eq.Amazon.com");
    assert.equal(params.get("currency"), "eq.GBP");
    assert.equal(params.get("and"), "(activity_date.gte.2028-02-01,activity_date.lte.2028-02-29)");
    assert.equal(params.get("source"), "eq.FINANCES");
    assert.equal(params.get("component_type"), "eq." + type);
    assert.equal(params.get("order"), "activity_date.desc,source.asc,source_row_id.asc");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "100");
    for (const key of ["month", "amount", "sku", "company_id", "seller_namespace"])
      assert.equal(params.has(key), false);
    assert.ok(init.signal instanceof AbortSignal);
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
    "Amazon.com",
    2,
    { source: "FINANCES", type },
    controller.signal,
  );
  assert.equal(page.totalCount, 101);
  assert.deepEqual(
    { ...page.rows[0] },
    {
      source_row_id: "row-1",
      source_version_id: "version-1",
      component_type: type,
      sku: null,
      amount: "0",
    },
  );
});

test("record requests may include all contributing sources and types without excluding zero", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    for (const key of [
      "source",
      "component_type",
      "amount",
      "sku",
      "company_id",
      "seller_namespace",
    ])
      assert.equal(params.has(key), false);
    assert.equal(params.get("marketplace_name"), "eq.Amazon.com");
    return new Response("amount\n0\n", { headers: { "Content-Range": "0-0/1" } });
  });
  assert.equal(
    (
      await client.fetchFinancialReviewRecords(
        "access",
        "FINANCES",
        "2026-07",
        "USD",
        "Amazon.com",
        0,
      )
    ).rows[0].amount,
    "0",
  );
});

test("invalid categories, years, months, currencies, record filters and page indices never query", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests++;
    return new Response("month\n");
  });
  for (const category of ["ANALYSIS_ONLY", "", "FINANCES,category.eq.SELBOX", null]) {
    await assert.rejects(client.fetchFinancialReviewBounds("access", category, "Amazon.com"));
    await assert.rejects(
      client.fetchFinancialReviewPeriodTypes(
        "access",
        category,
        "2026",
        "USD",
        "Amazon.com",
        "2026-07",
      ),
    );
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", category, "2026-07", "USD", "Amazon.com"),
    );
    assert.throws(() =>
      client.fetchFinancialReviewTypes("access", category, "2026-07", "USD", "Amazon.com"),
    );
  }
  for (const year of [null, undefined, 2026, "", "0000", "26", "02026", "2026-01", "2026,or=(id)"])
    await assert.rejects(
      client.fetchFinancialReviewPeriodTypes(
        "access",
        "FINANCES",
        year,
        "USD",
        "Amazon.com",
        "2026-07",
      ),
    );
  for (const month of ["2026-13", "2026-7", "2026-07-01", "0000-01", "2026-07,or=(id)"])
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", "FINANCES", month, "USD", "Amazon.com"),
    );
  for (const currency of [null, undefined, "usd", "", "US", "USD,EUR"]) {
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes(
        "access",
        "FINANCES",
        "2026-07",
        currency,
        "Amazon.com",
      ),
    );
    assert.throws(() =>
      client.fetchFinancialReviewTypes("access", "FINANCES", "2026-07", currency, "Amazon.com"),
    );
  }
  for (const page of [-1, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      client.fetchFinancialReviewRecords(
        "access",
        "FINANCES",
        "2026-07",
        "USD",
        "Amazon.com",
        page,
      ),
    );
  for (const filters of [{ source: "SELBOX" }, { type: "" }, { type: "hello\0world" }])
    assert.throws(() =>
      client.fetchFinancialReviewRecords(
        "access",
        "FINANCES",
        "2026-07",
        "USD",
        "Amazon.com",
        0,
        filters,
      ),
    );
  assert.equal(requests, 0);
});

test("empty bounds remain empty without invented months", async () => {
  const empty = createApiClient(SETTINGS, async () => new Response("activity_date\n"));
  assert.deepEqual(await empty.fetchFinancialReviewBounds("access", "SELBOX", "Amazon.com"), {
    firstMonth: null,
    lastMonth: null,
  });
});

test("a marketplace must be explicit and valid for every review read", async () => {
  const client = createApiClient(SETTINGS, () => assert.fail("Invalid scope must not query"));
  for (const marketplace of [
    undefined,
    null,
    "",
    "Germany",
    "Amazon.de,Amazon.fr",
    "Amazon.de\0",
  ]) {
    await assert.rejects(client.fetchFinancialReviewBounds("access", "FINANCES", marketplace));
    await assert.rejects(
      client.fetchFinancialReviewPeriodTypes(
        "access",
        "FINANCES",
        "2026",
        "EUR",
        marketplace,
        "2026-07",
      ),
    );
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", "FINANCES", "2026-07", "EUR", marketplace),
    );
    await assert.rejects(
      client.fetchFinancialReviewPeriodTypes(
        "access",
        "FINANCES",
        "2026",
        "EUR",
        marketplace,
        "2026-07",
      ),
    );
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", "FINANCES", "2026-07", "EUR", marketplace),
    );
    assert.throws(() =>
      client.fetchFinancialReviewTypes("access", "FINANCES", "2026-07", "EUR", marketplace),
    );
    assert.throws(() =>
      client.fetchFinancialReviewRecords("access", "FINANCES", "2026-07", "EUR", marketplace, 0),
    );
  }
});

test("malformed, inconsistent or oversized date anchors fail closed", async () => {
  for (const [first, last] of [
    ["2026-02-30", "2026-07-02"],
    ["not-a-date", "2026-07-02"],
    ["2026-08-01", "2026-07-31"],
    ["", "2026-07-02"],
    ["2026-01-01\n2026-02-01", "2026-07-02"],
  ]) {
    const client = createApiClient(
      SETTINGS,
      async (url) =>
        new Response(
          "activity_date\n" +
            (new URL(url).searchParams.get("order") === "activity_date.asc" ? first : last),
        ),
    );
    await assert.rejects(client.fetchFinancialReviewBounds("access", "FINANCES", "Amazon.com"));
  }
});

test("new bounded reads preserve permission and cancellation errors", async () => {
  const denied = createApiClient(
    SETTINGS,
    async () => new Response("private server details", { status: 403 }),
  );
  await assert.rejects(
    denied.fetchFinancialReviewFamilyTypes("access", "FINANCES", "2026-07", "USD", "Amazon.com"),
    (error) => error.status === 403 && !error.message.includes("private server details"),
  );
  const controller = new AbortController();
  controller.abort();
  const cancelled = createApiClient(SETTINGS, async (_url, init) => {
    init.signal.throwIfAborted();
  });
  await assert.rejects(
    cancelled.fetchFinancialReviewBounds("access", "FINANCES", "Amazon.com", controller.signal),
    (error) => error.name === "AbortError",
  );
  await assert.rejects(
    cancelled.fetchFinancialReviewFamilyTypes(
      "access",
      "FINANCES",
      "2026-07",
      "USD",
      "Amazon.com",
      controller.signal,
    ),
    (error) => error.name === "AbortError",
  );
});
