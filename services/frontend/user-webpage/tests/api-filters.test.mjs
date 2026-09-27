import { searchValues } from "./search-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG, isTableDataset } from "../src/api/config.ts";
import {
  SETTINGS,
  responseJson,
  pageRequest,
  datasetFilters,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  latestDateRequest,
  periodTotalsRequest,
  typeTotalsRequest,
} from "./api-fixtures.mjs";

test("column filters and resolved search share typed page and count arguments", async () => {
  const requests = [];
  const filters = datasetFilters({
    dateFrom: "2024-02-29",
    dateTo: "2024-03-01",
    skus: ["SKU_100%", 'quoted"value', "path\\value", "ＳＫＵ－１", "SKU_100%"],
    marketplaces: ["Amazon.com", "Amazon.co.jp"],
    sources: ["SETTLEMENT", "DATA_KIOSK"],
    types: ["PRODUCT_SALES", "FbaStorageFee"],
  });
  const client = createApiClient(SETTINGS, async (url, init) => {
    const args = JSON.parse(init.body);
    requests.push(args);
    assert.equal(new URL(url).search, "");
    assert.equal(new Headers(init.headers).has("Prefer"), false);
    return responseJson(
      new URL(url).pathname.endsWith("_count") ? "0" : { rows: [], total_count: "0" },
    );
  });
  await client.fetchDatasetPage(
    pageRequest("live", {
      filters,
      search: " SKU ",
      searchValues: searchValues({ skus: ["SKU"] }),
      pageIndex: 2,
    }),
  );
  await client.fetchDatasetCount({
    accessToken: "test-access",
    dataset: "live",
    filters,
    search: " SKU ",
    searchValues: searchValues({ skus: ["SKU"] }),
  });
  const { p_limit, p_offset, p_direction, p_order_by, p_include_count, ...pageFilters } =
    requests[0];
  assert.deepEqual(pageFilters, requests[1]);
  assert.deepEqual(pageFilters, {
    p_date_from: "2024-02-29",
    p_date_to: "2024-03-01",
    p_company_ids: [],
    p_skus: [...new Set(filters.skus)],
    p_marketplaces: filters.marketplaces,
    p_sources: filters.sources,
    p_types: filters.types,
    p_fee_applicable: null,
    p_search_skus: ["SKU"],
    p_search_types: [],
    p_search_marketplaces: [],
    p_search_sources: [],
  });
  assert.deepEqual(
    [p_limit, p_offset, p_direction, p_order_by, p_include_count],
    [25, 50, "desc", "date", true],
  );
  await client.fetchDatasetPage(
    pageRequest("settlement", {
      search: "SKU",
      searchValues: searchValues({ skus: ["SKU"] }),
      filters: datasetFilters({ dateTo: "2026-09-18", skus: ["SKU"] }),
    }),
  );
  assert.equal(requests[2].p_date_to, "2026-09-18");
  assert.equal(requests[2].p_dataset, "settlement");
});

test("empty selections preserve the unfiltered request", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url, body: init.body });
    return responseJson({ rows: [], total_count: "0" });
  });
  await client.fetchDatasetPage(pageRequest());
  await client.fetchDatasetPage(pageRequest("live", { filters: datasetFilters() }));
  assert.deepEqual(requests[0], requests[1]);
});

test("company, SKU, and marketplace selections compose across table and dedicated summary RPCs", async () => {
  const requests = [];
  const signal = new AbortController().signal;
  const client = createApiClient(SETTINGS, async (url, init) => {
    const endpoint = new URL(url).pathname;
    const args = JSON.parse(init.body);
    requests.push({ init, args, endpoint });
    if (endpoint.endsWith("/transaction_page"))
      return responseJson({ rows: [], total_count: null });
    if (endpoint.endsWith("/transaction_totals"))
      return responseJson({ rows: [], next_offset: null });
    assert.fail(`Unexpected summary request: ${endpoint}`);
  });
  const dates = { dateFrom: "2024-02-01", dateTo: "2024-02-29" };
  const companyIds = Object.freeze([OTHER_COMPANY_ID, COMPANY_ID, OTHER_COMPANY_ID]);
  const skus = Object.freeze([
    "SKU_100%",
    "a,b(c).d",
    'quoted"value',
    "path\\value",
    "ＳＫＵ－１",
    "  spaced SKU  ",
    "Sku",
    "sku",
    "SKU_100%",
  ]);
  const marketplaces = Object.freeze([
    "Amazon.co.jp",
    "Amazon.com",
    'quoted"market',
    "path\\market",
    "地域",
    "  Marketplace  ",
    "Amazon.com",
  ]);
  const scope = { companyIds, skus, marketplaces };
  await client.fetchDatasetPage(
    pageRequest("live", {
      signal,
      search: "SKU",
      searchValues: searchValues({ skus: ["SKU"] }),
      filters: datasetFilters({ ...dates, ...scope, types: ["PRODUCT_SALES"] }),
    }),
  );
  await client.fetchLatestTransactionDate(latestDateRequest({ ...scope, signal }));
  await client.fetchTransactionPeriodTotals(
    periodTotalsRequest({
      ...scope,
      signal,
      sources: ["DATA_KIOSK"],
      types: ["PRODUCT_SALES"],
      feeApplicability: ["applicable"],
      search: "ignored",
    }),
  );
  await client.fetchTransactionTypeTotals(
    typeTotalsRequest({
      ...scope,
      signal,
      sources: ["DATA_KIOSK"],
      types: ["PRODUCT_SALES"],
      feeApplicability: ["applicable"],
      search: "ignored",
    }),
  );
  assert.equal(requests.length, 4);
  const table = requests[0];
  assert.deepEqual(table.args.p_company_ids, [COMPANY_ID, OTHER_COMPANY_ID]);
  assert.equal(table.args.p_date_from, dates.dateFrom);
  assert.equal(table.args.p_date_to, dates.dateTo);
  assert.deepEqual(table.args.p_types, ["PRODUCT_SALES"]);
  assert.deepEqual(table.args.p_search_skus, ["SKU"]);
  assert.equal("p_search" in table.args, false);
  assert.equal(new Headers(table.init.headers).has("Prefer"), false);
  assert.deepEqual(table.args.p_skus, [...new Set(skus)]);
  assert.deepEqual(table.args.p_marketplaces, [...new Set(marketplaces)]);
  for (const request of requests) assert.equal(request.init.signal, signal);
  for (const { args, init } of requests.slice(1)) {
    assert.deepEqual([...args.p_company_ids].sort(), [...new Set(companyIds)].sort());
    assert.deepEqual([...args.p_skus].sort(), [...new Set(skus)].sort());
    assert.deepEqual([...args.p_marketplaces].sort(), [...new Set(marketplaces)].sort());
    assert.equal(new Headers(init.headers).has("Prefer"), false);
  }
  const latest = requests[1].args;
  assert.equal(latest.p_limit, 1);
  assert.equal(latest.p_include_count, false);
  assert.equal(latest.p_date_from, null);
  assert.equal(latest.p_date_to, null);
  assert.deepEqual(latest.p_sources, []);
  assert.deepEqual(latest.p_types, []);
  assert.equal(latest.p_fee_applicable, null);
  for (const { args, endpoint } of requests.slice(2)) {
    assert.equal(endpoint, "/rest/v1/rpc/transaction_totals");
    assert.equal(args.p_date_from, dates.dateFrom);
    assert.equal(args.p_date_to, dates.dateTo);
    assert.equal(args.p_limit, 1000);
    assert.equal(args.p_offset, 0);
    for (const excluded of ["p_sources", "p_types", "p_fee_applicable", "search"])
      assert.equal(Object.hasOwn(args, excluded), false);
  }
  assert.equal(requests[2].args.p_group_by_type, false);
  assert.equal(requests[2].args.p_currency, null);
  assert.equal(requests[3].args.p_group_by_type, true);
  assert.equal(requests[3].args.p_currency, "USD");
});

test("empty or omitted summary scopes leave requests unchanged", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url, body: init.body });
    if (new URL(url).pathname === "/rest/v1/rpc/transaction_page") {
      return responseJson({ rows: [], total_count: "0" });
    }
    return responseJson({ rows: [], next_offset: null });
  });
  for (const values of [undefined, []]) {
    const scope = { companyIds: values, skus: values, marketplaces: values };
    await client.fetchDatasetPage(pageRequest("live", { filters: datasetFilters(scope) }));
    await client.fetchLatestTransactionDate(latestDateRequest(scope));
    await client.fetchTransactionPeriodTotals(periodTotalsRequest(scope));
    await client.fetchTransactionTypeTotals(typeTotalsRequest(scope));
  }
  assert.deepEqual(requests.slice(0, 4), requests.slice(4));
  const urls = requests.map(({ url }) => url);
  assert.ok(urls.every((url) => !new URL(url).searchParams.has("company_id")));
  assert.ok(urls.every((url) => !new URL(url).searchParams.has("sku")));
  assert.ok(urls.every((url) => !new URL(url).searchParams.has("marketplace_name")));
});

test("invalid SKU and marketplace values fail before HTTP for tables and all summaries", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return new Response("");
  });
  for (const field of ["skus", "marketplaces"]) {
    for (const values of [
      null,
      "value",
      ["valid", null],
      ["valid", 1],
      [""],
      ["bad\0value"],
      [undefined],
      Array(1),
    ]) {
      const scope = { [field]: values };
      await assert.rejects(
        client.fetchDatasetPage(pageRequest("live", { filters: datasetFilters(scope) })),
        /valid (SKU|marketplace) values/,
      );
      await assert.rejects(
        client.fetchLatestTransactionDate(latestDateRequest(scope)),
        /valid (SKU|marketplace) values/,
      );
      await assert.rejects(
        client.fetchTransactionPeriodTotals(periodTotalsRequest(scope)),
        /valid (SKU|marketplace) values/,
      );
      await assert.rejects(
        client.fetchTransactionTypeTotals(typeTotalsRequest(scope)),
        /valid (SKU|marketplace) values/,
      );
    }
  }
  assert.equal(requests, 0);
});

test("latest-date company selections use typed arrays and remove duplicate IDs", async () => {
  const selections = [];
  const client = createApiClient(SETTINGS, async (_url, init) => {
    selections.push(JSON.parse(init.body).p_company_ids);
    return responseJson({ rows: [], total_count: null });
  });
  for (const companyIds of [
    [COMPANY_ID],
    [OTHER_COMPANY_ID, COMPANY_ID],
    [COMPANY_ID, OTHER_COMPANY_ID, COMPANY_ID],
  ]) {
    await client.fetchLatestTransactionDate(latestDateRequest({ companyIds }));
  }
  assert.deepEqual(selections, [
    [COMPANY_ID],
    [COMPANY_ID, OTHER_COMPANY_ID],
    [COMPANY_ID, OTHER_COMPANY_ID],
  ]);
});

test("invalid company UUIDs and company filters on other datasets fail before HTTP", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return new Response("");
  });
  for (const companyIds of [
    [COMPANY_ID, "company-a"],
    [""],
    [" "],
    [`${COMPANY_ID},or(company_id.is.null)`],
    [COMPANY_ID.slice(1)],
    [COMPANY_ID, null],
    Array(1),
    COMPANY_ID,
  ]) {
    await assert.rejects(
      client.fetchDatasetPage(pageRequest("live", { filters: datasetFilters({ companyIds }) })),
      /valid company IDs/,
    );
    await assert.rejects(
      client.fetchLatestTransactionDate(latestDateRequest({ companyIds })),
      /valid company IDs/,
    );
    await assert.rejects(
      client.fetchTransactionPeriodTotals(periodTotalsRequest({ companyIds })),
      /valid company IDs/,
    );
    await assert.rejects(
      client.fetchTransactionTypeTotals(typeTotalsRequest({ companyIds })),
      /valid company IDs/,
    );
  }
  for (const dataset of Object.keys(DATASET_CONFIG).filter(
    (key) => isTableDataset(key) && key !== "live",
  )) {
    await assert.rejects(
      client.fetchDatasetPage(
        pageRequest(dataset, { filters: datasetFilters({ companyIds: [COMPANY_ID] }) }),
      ),
      /Company filtering is unavailable/,
    );
  }
  assert.equal(requests, 0);
});

test("invalid calendar periods and unsupported column filters fail before sending a request", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return new Response("");
  });
  for (const dateFrom of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-9-1",
    "2026-09-01T00:00:00Z",
  ]) {
    await assert.rejects(
      client.fetchDatasetPage(
        pageRequest("live", {
          filters: datasetFilters({ dateFrom }),
        }),
      ),
      /valid.*date/,
    );
  }
  await assert.rejects(
    client.fetchDatasetPage(
      pageRequest("live", {
        filters: datasetFilters({ dateFrom: "2026-09-02", dateTo: "2026-09-01" }),
      }),
    ),
    /start date/,
  );
  for (const [dataset, filters] of [
    ["settlement", datasetFilters({ sources: ["SETTLEMENT"] })],
    ["accounts", datasetFilters({ marketplaces: ["Amazon.com"] })],
    ["payouts", datasetFilters({ dateFrom: "2026-09-01" })],
    ["live", datasetFilters({ skus: ["invalid\0value"] })],
  ]) {
    await assert.rejects(client.fetchDatasetPage(pageRequest(dataset, { filters })));
  }
  assert.equal(requests, 0);
});

test("fee applicability uses the same selection for page RPC, counts, search, and reported amount ordering", async () => {
  for (const [feeApplicability, expected] of [
    [[], null],
    [["applicable"], true],
    [["not_applicable"], false],
    [["applicable", "applicable"], true],
    [["not_applicable", "applicable"], null],
  ]) {
    const requests = [];
    const client = createApiClient(SETTINGS, async (url, init) => {
      const args = JSON.parse(init.body);
      requests.push(args);
      if (new URL(url).pathname.endsWith("/transaction_count")) return responseJson("0");
      assert.equal(new URL(url).pathname, "/rest/v1/rpc/transaction_page");
      return responseJson({ rows: [], total_count: "0" });
    });
    const filters = datasetFilters({ feeApplicability, skus: ["SKU"], dateFrom: "2026-09-01" });
    await client.fetchDatasetPage(pageRequest("live", { filters }));
    await client.fetchDatasetCount({
      accessToken: "test-access",
      dataset: "live",
      search: "",
      filters,
    });
    await client.fetchDatasetPage(
      pageRequest("live", { filters, sort: { column: "source_amount", direction: "desc" } }),
    );
    await client.fetchDatasetPage(
      pageRequest("live", {
        filters,
        search: "SKU",
        searchValues: searchValues({ skus: ["SKU"] }),
      }),
    );
    await client.fetchDatasetCount({
      accessToken: "test-access",
      dataset: "live",
      search: "SKU",
      searchValues: searchValues({ skus: ["SKU"] }),
      filters,
    });
    for (const args of requests) {
      assert.equal(args.p_fee_applicable, expected);
      assert.deepEqual(args.p_skus, ["SKU"]);
      assert.equal(args.p_date_from, "2026-09-01");
    }
  }
});

test("invalid fee selections and unsupported dataset fee filters fail before HTTP", async () => {
  const client = createApiClient(SETTINGS, () =>
    assert.fail("Invalid filters must not reach HTTP"),
  );
  for (const feeApplicability of [
    null,
    "applicable",
    ["APPLIED"],
    ["applicable", null],
    Array(1),
    [""],
    [1],
  ]) {
    const filters = datasetFilters({ feeApplicability });
    await assert.rejects(
      client.fetchDatasetPage(pageRequest("live", { filters })),
      /fee applicability/,
    );
    await assert.rejects(
      client.fetchDatasetCount({
        accessToken: "test-access",
        dataset: "live",
        search: "",
        filters,
      }),
      /fee applicability/,
    );
  }
  for (const dataset of Object.keys(DATASET_CONFIG).filter(
    (dataset) => isTableDataset(dataset) && dataset !== "live",
  )) {
    await assert.rejects(
      client.fetchDatasetPage(
        pageRequest(dataset, {
          filters: datasetFilters({ feeApplicability: ["applicable"] }),
        }),
      ),
      /Fee applicability filtering is unavailable/,
    );
  }
});

test("unsupported monetary orderings are rejected before sending any request", async () => {
  const client = createApiClient(SETTINGS, () =>
    assert.fail("Unsupported sorts must not reach HTTP"),
  );
  for (const [dataset, columns] of [
    ["live", ["company_amount", "fee_rate_percent", "fee_amount"]],
    ["payouts", ["source_amount", "fee_amount"]],
  ]) {
    for (const column of columns) {
      await assert.rejects(
        client.fetchDatasetPage(pageRequest(dataset, { sort: { column, direction: "desc" } })),
      );
    }
  }
});
