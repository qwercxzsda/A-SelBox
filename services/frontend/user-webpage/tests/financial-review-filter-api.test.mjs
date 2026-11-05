import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS } from "./api-fixtures.mjs";
import { csv } from "./e2e/api-fixtures.mjs";
import { respondWithFinancialReview } from "./e2e/mocks/financial-review.mjs";

function mockReviewClient(fixture) {
  return createApiClient(SETTINGS, (url) =>
    respondWithFinancialReview(fixture, {
      request: {},
      url: new URL(url),
      user: "admin",
      track: () => {},
      reply: (body, status) => new Response(JSON.stringify(body), { status }),
      csvReply: (columns, rows, total, offset) =>
        new Response(csv(columns, rows), {
          headers: {
            "Content-Range": `${rows.length ? `${offset}-${offset + rows.length - 1}` : "*"}/${total}`,
          },
        }),
    }),
  );
}

test("family type filters intersect the existing monthly source/type scope before server paging", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests++;
    const params = new URL(url).searchParams;
    assert.equal(
      params.get("or"),
      '(and(source.eq.FINANCES,component_type.in.("STORAGE_FEES","AGED_STORAGE_FEES")),and(source.eq.DATA_KIOSK,component_type.in.("FBA_STORAGE_FEE","MONTHLY_INVENTORY_STORAGE_FEE","LONG_TERM_STORAGE_FEE","FBA_AGED_INVENTORY_SURCHARGE")))',
    );
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "50");
    assert.equal(init.headers.Prefer, "count=exact");
    if (new URL(url).pathname.endsWith("financial_review_records")) {
      assert.equal(params.get("category"), "eq.DATA_KIOSK");
      assert.equal(params.get("marketplace_name"), "eq.Amazon.com");
      assert.equal(params.get("currency"), "eq.USD");
      assert.equal(params.get("source"), "eq.FINANCES");
      assert.equal(params.get("component_type"), "eq.STORAGE_FEES");
      assert.equal(
        params.get("and"),
        "(activity_date.gte.2026-07-01,activity_date.lte.2026-07-31)",
      );
    } else {
      assert.equal(params.get("p_category"), "DATA_KIOSK");
      assert.equal(params.get("p_marketplace"), "Amazon.com");
      assert.equal(params.get("p_currency"), "USD");
      assert.equal(params.get("p_month_from"), "2026-07-01");
      assert.equal(params.get("p_month_to"), "2026-08-01");
    }
    return new Response("amount\n", { headers: { "Content-Range": "*/0" } });
  });
  const families = ["monthly-storage", "aged-storage", "monthly-storage"];
  await client.fetchFinancialReviewTypes(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    undefined,
    families,
  );
  await client.fetchFinancialReviewRecords(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    { source: "FINANCES", type: "STORAGE_FEES" },
    undefined,
    families,
  );
  assert.equal(requests, 2);
});

test("unknown family identities escape punctuation literally and never include the other source", async () => {
  const type = 'UNKNOWN, (fee)."quoted"\\path\nnext';
  const id = `source:DATA_KIOSK:${encodeURIComponent(type)}`;
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(
      params.get("or"),
      `(and(source.eq.DATA_KIOSK,component_type.in.("${type.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")))`,
    );
    return new Response("amount\n", { headers: { "Content-Range": "*/0" } });
  });
  await client.fetchFinancialReviewRecords(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    0,
    {},
    undefined,
    [id],
  );
  await client.fetchFinancialReviewTypes(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    0,
    undefined,
    [id],
  );
});

test("retired net-sales and referral IDs request one exact source-qualified economic union", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    requests.push(params);
    assert.equal(
      params.get("or"),
      '(and(source.eq.FINANCES,component_type.in.("PRODUCT_SALES","PRODUCT_REFUNDS","ZERO_ACTIVITY","REFERRAL_FEES","REFUNDED_REFERRAL_FEES")),and(source.eq.DATA_KIOSK,component_type.in.("NET_PRODUCT_SALES","REFERRAL_FEE","REFERRAL_FEES","REFUNDED_REFERRAL_FEE")))',
    );
    return new Response("amount\n", { headers: { "Content-Range": "*/0" } });
  });
  const ids = [
    "product-sales",
    "product-refunds",
    "zero-activity",
    "net-product-sales",
    "refunded-referral",
    "referral",
  ];
  await client.fetchFinancialReviewTypes(
    "access",
    "FINANCES",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    undefined,
    ids,
  );
  await client.fetchFinancialReviewRecords(
    "access",
    "FINANCES",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    { source: "FINANCES", type: "PRODUCT_REFUNDS" },
    undefined,
    ids,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].get("p_category"), "FINANCES");
  assert.equal(requests[0].get("offset"), "50");
  assert.equal(requests[1].get("category"), "eq.FINANCES");
  assert.equal(requests[1].get("source"), "eq.FINANCES");
  assert.equal(requests[1].get("component_type"), "eq.PRODUCT_REFUNDS");
  assert.equal(requests[1].get("offset"), "50");
});

test("source-only balance aliases remain a Finances-only union alongside existing source filters", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(
      params.get("or"),
      '(and(source.eq.FINANCES,component_type.in.("DEBT_RECOVERY","CROSS_ACCOUNT_ADJUSTMENTS","RESERVE_MOVEMENTS","BANK_TRANSFERS")))',
    );
    assert.equal(params.get("category"), "eq.SELBOX");
    assert.equal(params.get("source"), "eq.DATA_KIOSK");
    return new Response("amount\n", { headers: { "Content-Range": "*/0" } });
  });
  const result = await client.fetchFinancialReviewRecords(
    "access",
    "SELBOX",
    "2026-07",
    "USD",
    "Amazon.com",
    0,
    { source: "DATA_KIOSK" },
    undefined,
    ["debt-recovery", "bank-transfers", "balance-movements"],
  );
  assert.equal(result.totalCount, 0);
  assert.deepEqual(result.rows, []);
});

test("invalid nonempty family selections never broaden to an unrestricted request", () => {
  const client = createApiClient(SETTINGS, () => assert.fail("invalid families must not query"));
  for (const ids of [
    null,
    "monthly-storage",
    [null],
    ["not-a-family"],
    ["source:FINANCES:%"],
    ["monthly-storage", "invalid"],
    ["product-sales", "invalid"],
  ]) {
    assert.throws(() =>
      client.fetchFinancialReviewTypes(
        "access",
        "DATA_KIOSK",
        "2026-07",
        "USD",
        "Amazon.com",
        0,
        undefined,
        ids,
      ),
    );
    assert.throws(() =>
      client.fetchFinancialReviewRecords(
        "access",
        "DATA_KIOSK",
        "2026-07",
        "USD",
        "Amazon.com",
        0,
        {},
        undefined,
        ids,
      ),
    );
  }
});

test("review browser fixtures apply source-specific family intersections before exact counts and paging", async () => {
  const base = {
    month: "2026-07-01",
    activity_date: "2026-07-12",
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    currency: "USD",
    source: "FINANCES",
    component_type: "STORAGE_FEES",
    amount: "0",
    row_count: "1",
  };
  const unknown = 'FUTURE, (fee)."literal"\\path\nnext';
  const records = [
    ...Array.from({ length: 52 }, (_, index) => ({
      ...base,
      source_row_id: `ROW-${String(index).padStart(2, "0")}`,
    })),
    { ...base, source: "DATA_KIOSK", component_type: "FBA_STORAGE_FEE", source_row_id: "KIOSK" },
    { ...base, source: "DATA_KIOSK", source_row_id: "WRONG-SOURCE" },
    { ...base, currency: "EUR", source_row_id: "OTHER-CURRENCY" },
    { ...base, marketplace_name: "Amazon.ca", source_row_id: "OTHER-MARKETPLACE" },
    { ...base, category: "SELBOX", source_row_id: "OTHER-CATEGORY" },
    { ...base, month: "2026-06-01", activity_date: "2026-06-12", source_row_id: "OTHER-MONTH" },
    { ...base, component_type: unknown, source_row_id: "UNKNOWN-FINANCES" },
    { ...base, component_type: unknown, source: "DATA_KIOSK", source_row_id: "UNKNOWN-KIOSK" },
  ];
  const fixture = {
    roles: { admin: "administrator" },
    financialReviewRequests: [],
    financialReviewStatus: 200,
    beforeFinancialReview: async () => {},
    payoutPolicy: { mature_cutoff_date: "2027-01-27" },
    financialReviewRecords: records,
    financialReviewTypeTotals: [
      { ...base, row_count: "52" },
      { ...base, source: "DATA_KIOSK", component_type: "FBA_STORAGE_FEE" },
      { ...base, source: "DATA_KIOSK" },
      { ...base, month: "2026-06-01" },
    ],
  };
  const client = mockReviewClient(fixture);
  const page = await client.fetchFinancialReviewRecords(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    {},
    undefined,
    ["monthly-storage"],
  );
  assert.equal(page.totalCount, 53);
  assert.equal(page.rows.length, 3);
  assert.ok(
    page.rows.every((row) => row.source === "FINANCES" && row.component_type === "STORAGE_FEES"),
  );
  const onlyFinances = await client.fetchFinancialReviewRecords(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    1,
    { source: "FINANCES", type: "STORAGE_FEES" },
    undefined,
    ["monthly-storage"],
  );
  assert.equal(onlyFinances.totalCount, 52);
  assert.equal(onlyFinances.rows.length, 2);
  const types = await client.fetchFinancialReviewTypes(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    0,
    undefined,
    ["monthly-storage"],
  );
  assert.equal(types.totalCount, 2);
  assert.equal(types.rows.length, 2);
  assert.equal(
    (
      await client.fetchFinancialReviewPeriodTypes(
        "access",
        "DATA_KIOSK",
        "2026",
        "USD",
        "Amazon.com",
      )
    ).length,
    4,
  );
  const exactUnknown = await client.fetchFinancialReviewRecords(
    "access",
    "DATA_KIOSK",
    "2026-07",
    "USD",
    "Amazon.com",
    0,
    {},
    undefined,
    [`source:DATA_KIOSK:${encodeURIComponent(unknown)}`],
  );
  assert.equal(exactUnknown.totalCount, 1);
  assert.equal(exactUnknown.rows[0].source_row_id, "UNKNOWN-KIOSK");
});

test("Germany and France using EUR stay separate before family counts, records and type paging", async () => {
  const base = {
    month: "2026-07-01",
    activity_date: "2026-07-12",
    category: "DATA_KIOSK",
    currency: "EUR",
    source: "FINANCES",
    component_type: "STORAGE_FEES",
  };
  const markets = [
    ["Amazon.de", 52],
    ["Amazon.fr", 57],
  ];
  const fixture = {
    roles: { admin: "administrator" },
    financialReviewRequests: [],
    financialReviewStatus: 200,
    beforeFinancialReview: async () => {},
    payoutPolicy: { mature_cutoff_date: "2027-01-27" },
    financialReviewRecords: markets.flatMap(([marketplace_name, count]) =>
      Array.from({ length: count }, (_, index) => ({
        ...base,
        marketplace_name,
        amount: "1",
        source_row_id: `${marketplace_name}-${index}`,
      })),
    ),
    financialReviewTypeTotals: markets.map(([marketplace_name, count]) => ({
      ...base,
      marketplace_name,
      amount: String(count),
      row_count: String(count),
    })),
    financialReviewTotals: markets.map(([marketplace_name, count]) => ({
      ...base,
      marketplace_name,
      finances_amount: String(count),
      data_kiosk_amount: "0",
      difference: String(count),
      finances_row_count: String(count),
      data_kiosk_row_count: "0",
    })),
  };
  const client = mockReviewClient(fixture);
  for (const [marketplace, count] of markets) {
    const page = await client.fetchFinancialReviewRecords(
      "access",
      "DATA_KIOSK",
      "2026-07",
      "EUR",
      marketplace,
      1,
      {},
      undefined,
      ["monthly-storage"],
    );
    assert.equal(page.totalCount, count);
    assert.equal(page.rows.length, count - 50);
    assert.ok(page.rows.every((row) => row.marketplace_name === marketplace));
    const types = await client.fetchFinancialReviewPeriodTypes(
      "access",
      "DATA_KIOSK",
      "2026",
      "EUR",
      marketplace,
    );
    assert.equal(types.length, 1);
    assert.equal(types[0].marketplace_name, marketplace);
    assert.equal(types[0].amount, String(count));
    const totals = await client.fetchFinancialReviewPeriod(
      "access",
      "DATA_KIOSK",
      "2026",
      marketplace,
    );
    assert.equal(totals.length, 1);
    assert.equal(totals[0].marketplace_name, marketplace);
    assert.equal(totals[0].difference, String(count));
  }
});
