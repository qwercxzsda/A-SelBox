import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

const REVISION = { finances: "f1", data_kiosk: "k1" };
function sourceClient(fetcher) {
  return createApiClient(SETTINGS, (url, init) =>
    new URL(url).pathname.endsWith("/workspace_revisions")
      ? new Response(JSON.stringify({ revisions: REVISION }))
      : fetcher(url, init),
  );
}

const typeGroup = (overrides = {}) => ({
  month: "2026-07-01",
  category: "DATA_KIOSK",
  marketplace_name: "Amazon.com",
  currency: "USD",
  source: "FINANCES",
  component_type: "STORAGE_FEES",
  amount: "-9007199254740993.123456789",
  row_count: "9007199254740991",
  ...overrides,
});

function pageResponse(rows, count, offset = 0) {
  const body = rows.length
    ? [csvRecord(rows[0]), ...rows.slice(1).map((row) => csvRecord(row).split("\n")[1])].join("\n")
    : Object.keys(typeGroup()).join(",") + "\n";
  return new Response(body, {
    headers: {
      "Content-Range": `${rows.length ? `${offset}-${offset + rows.length - 1}` : "*"}/${count ?? "*"}`,
    },
  });
}

const readYear = (client, signal) =>
  client.fetchFinancialReviewPeriodTypes(
    "access",
    "DATA_KIOSK",
    "2026",
    "USD",
    "Amazon.com",
    signal,
  );

test("year reads retain recent months without requesting payout maturity", async () => {
  const rows = [typeGroup(), typeGroup({ month: "2026-11-01" })];
  const client = sourceClient(async (url) => {
    const request = new URL(url);
    assert.equal(request.pathname, "/rest/v1/rpc/financial_review_type_totals");
    assert.equal(request.searchParams.get("p_month_from"), "2026-01-01");
    assert.equal(request.searchParams.get("p_month_to"), "2027-01-01");
    return pageResponse(rows, rows.length);
  });
  assert.deepEqual(
    (await readYear(client)).rows.map((row) => row.month),
    ["2026-07-01", "2026-11-01"],
  );
});

test("complete year type totals traverse beyond 1000 groups without losing decimal or count precision", async () => {
  const expected = Array.from({ length: 1001 }, (_, index) =>
    typeGroup({
      component_type: `TYPE-${String(index).padStart(4, "0")}`,
    }),
  );
  const offsets = [];
  const client = sourceClient(async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/rpc/financial_review_type_totals");
    assert.equal(params.get("p_category"), "DATA_KIOSK");
    assert.equal(params.get("p_marketplace"), "Amazon.com");
    assert.equal(params.get("p_month_from"), "2026-01-01");
    assert.equal(params.get("p_month_to"), "2027-01-01");
    assert.equal(params.get("p_currency"), "USD");
    assert.equal(params.get("order"), "month.asc,source.asc,component_type.asc");
    assert.equal(params.get("limit"), "1000");
    assert.equal(init.headers.Prefer, "count=exact");
    assert.equal(init.headers.Authorization, "Bearer access");
    assert.ok(init.signal instanceof AbortSignal);
    const selected = params.get("select").split(",");
    assert.deepEqual(selected, [...selected].sort());
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    return pageResponse(expected.slice(offset, offset + 1000), expected.length, offset);
  });
  assert.deepEqual(
    (await readYear(client)).rows.map((row) => ({ ...row })),
    expected,
  );
  assert.deepEqual(offsets, [0, 1000]);
});

test("complete reads tolerate smaller server page caps and distinguish repeated types in different months", async () => {
  const expected = ["01", "02", "03", "04", "05"].map((month) =>
    typeGroup({ month: `2026-${month}-01` }),
  );
  const offsets = [];
  const client = sourceClient(async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    offsets.push(offset);
    return pageResponse(expected.slice(offset, offset + 2), expected.length, offset);
  });
  assert.equal((await readYear(client)).rows.length, 5);
  assert.deepEqual(offsets, [0, 2, 4]);
});

test("monthly family comparisons reuse complete count-aware paging", async () => {
  const rows = [
    typeGroup(),
    typeGroup({
      source: "DATA_KIOSK",
      component_type: "FBA_STORAGE_FEE",
      amount: "0",
      row_count: "1",
    }),
  ];
  const offsets = [];
  const client = sourceClient(async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("p_month_from"), "2026-07-01");
    assert.equal(params.get("p_month_to"), "2026-08-01");
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    return pageResponse(rows.slice(offset, offset + 1), rows.length, offset);
  });
  assert.equal(
    (
      await client.fetchFinancialReviewFamilyTypes(
        "access",
        "DATA_KIOSK",
        "2026-07",
        "USD",
        "Amazon.com",
      )
    ).rows.length,
    2,
  );
  assert.deepEqual(offsets, [0, 1]);
});

test("complete comparisons reject missing counts, changing counts, duplicate groups and early exhaustion", async () => {
  const one = typeGroup();
  const two = typeGroup({ component_type: "COUPON_FEES" });
  for (const responses of [
    [[[], null]],
    [
      [[one], 2],
      [[two], 3],
    ],
    [
      [[one], 2],
      [[], 2],
    ],
    [
      [[one], 2],
      [[one], 2],
    ],
    [[[one, one], 2]],
    [[[one, two], 1]],
    [[[one], 0]],
    [[Array.from({ length: 1001 }, () => one), 1001]],
  ]) {
    let requests = 0;
    const client = sourceClient(async (url) => {
      assert.ok(
        requests < responses.length,
        "an inconsistent read must stop instead of retrying indefinitely",
      );
      const [rows, count] = responses[requests++];
      return pageResponse(rows, count, Number(new URL(url).searchParams.get("offset")));
    });
    await assert.rejects(readYear(client));
  }
});

test("scope, source, exact amount and positive safe record counts are validated before exposing totals", async () => {
  for (const patch of [
    { month: "2025-12-01" },
    { month: "2027-01-01" },
    { month: "2026-02-30" },
    { month: "2026-07-02" },
    { month: null },
    { category: "SELBOX" },
    { marketplace_name: "Amazon.de" },
    { marketplace_name: null },
    { currency: "JPY" },
    { currency: null },
    { source: "SELBOX" },
    { source: null },
    { component_type: "" },
    { component_type: null },
    { component_type: "BAD\0TYPE" },
    { amount: null },
    { amount: "NaN" },
    { amount: "Infinity" },
    { amount: "1e999999999" },
    { row_count: null },
    { row_count: "0" },
    { row_count: "-1" },
    { row_count: "1.5" },
    { row_count: "9007199254740992" },
  ]) {
    const client = sourceClient(async () => pageResponse([typeGroup(patch)], 1));
    await assert.rejects(readYear(client), undefined, JSON.stringify(patch));
  }
});

test("complete comparisons stop at explicit group and request bounds rather than returning partial totals", async () => {
  let requests = 0;
  const tooMany = sourceClient(async () => {
    requests++;
    return pageResponse([typeGroup()], 50_001);
  });
  await assert.rejects(readYear(tooMany), /complete comparison limit/);
  assert.equal(requests, 1);
  requests = 0;
  const tinyPages = sourceClient(async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    requests++;
    return pageResponse([typeGroup({ component_type: `TYPE-${offset}` })], 201, offset);
  });
  await assert.rejects(readYear(tinyPages), /complete comparison page limit/);
  assert.equal(requests, 200);
});

test("empty complete reads and calendar endpoints stay bounded", async () => {
  for (const [year, end] of [
    ["0001", "0002-01-01"],
    ["9999", "10000-01-01"],
  ]) {
    const client = sourceClient(async (url) => {
      const params = new URL(url).searchParams;
      assert.equal(params.get("p_month_from"), `${year}-01-01`);
      assert.equal(params.get("p_month_to"), end);
      return pageResponse([], 0);
    });
    assert.deepEqual(
      (
        await client.fetchFinancialReviewPeriodTypes(
          "access",
          "FINANCES",
          year,
          "USD",
          "Amazon.com",
        )
      ).rows,
      [],
    );
  }
});

test("invalid complete-read inputs never query; permission and cancellation errors remain intact", async () => {
  let requests = 0;
  const invalid = sourceClient(async () => {
    requests++;
    return pageResponse([], 0);
  });
  for (const [category, year, currency] of [
    ["INVALID", "2026", "USD"],
    ["FINANCES", "0000", "USD"],
    ["FINANCES", 2026, "USD"],
    ["FINANCES", "2026", "usd"],
  ])
    await assert.rejects(
      invalid.fetchFinancialReviewPeriodTypes("access", category, year, currency, "Amazon.com"),
    );
  assert.equal(requests, 0);
  const denied = createApiClient(
    SETTINGS,
    async () => new Response("private response", { status: 403 }),
  );
  await assert.rejects(
    readYear(denied),
    (error) => error.status === 403 && !error.message.includes("private response"),
  );
  const controller = new AbortController();
  const reason = new Error("Scope changed");
  const cancelled = sourceClient(async () => {
    requests++;
    controller.abort(reason);
    return pageResponse([typeGroup()], 2);
  });
  await assert.rejects(readYear(cancelled, controller.signal), (error) => error === reason);
  assert.equal(requests, 1);
});

test("complete type reads reject source changes between their revision checks", async () => {
  let revisions = 0;
  const client = createApiClient(SETTINGS, async (url) => {
    if (new URL(url).pathname.endsWith("/workspace_revisions"))
      return new Response(
        JSON.stringify({ revisions: { ...REVISION, finances: String(++revisions) } }),
      );
    return pageResponse([typeGroup()], 1);
  });
  await assert.rejects(readYear(client), /changed while loading/);
  assert.equal(revisions, 2);
});

test("successful complete type reads return the revisions that bracket their rows", async () => {
  const result = await readYear(sourceClient(async () => pageResponse([typeGroup()], 1)));
  assert.deepEqual(result.revision, REVISION);
  assert.deepEqual(
    result.rows.map((row) => ({ ...row })),
    [typeGroup()],
  );
});
