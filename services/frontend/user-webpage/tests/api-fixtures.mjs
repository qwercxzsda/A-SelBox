import { DATASET_CONFIG } from "../src/api/config.ts";

export const SETTINGS = {
  supabaseUrl: "https://api.example.invalid",
  publishableKey: "sb_publishable_unit_test_key",
};

export const SESSION = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1800000000,
  user: { id: "user-1", email: "member@example.invalid" },
};

export function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function datasetRecord(dataset, overrides = {}) {
  return Object.assign(
    Object.fromEntries(DATASET_CONFIG[dataset].selectColumns.map((column) => [column, column])),
    overrides,
  );
}

export function csvRecord(record) {
  const columns = Object.keys(record);
  const cell = (value) => (value === null ? "" : `"${String(value).replaceAll('"', '""')}"`);
  return `${columns.join(",")}\n${columns.map((column) => cell(record[column])).join(",")}`;
}

export function pageRequest(dataset = "live", overrides = {}) {
  return {
    accessToken: "test-access",
    dataset,
    pageIndex: 0,
    pageSize: 25,
    search: "",
    sort: DATASET_CONFIG[dataset].defaultSort,
    ...overrides,
  };
}

export function datasetFilters(overrides = {}) {
  return {
    companyIds: [],
    dateFrom: "",
    dateTo: "",
    skus: [],
    marketplaces: [],
    sources: [],
    types: [],
    feeApplicability: [],
    ...overrides,
  };
}

export const COMPANY_ID = "0198b50b-701a-7000-8000-000000000001";

export const OTHER_COMPANY_ID = "0198b50b-701a-7000-8000-000000000002";

export function latestDateRequest(overrides = {}) {
  return { accessToken: "test-access", ...overrides };
}

export function periodTotalsRequest(overrides = {}) {
  return {
    ...latestDateRequest(),
    dateFrom: "2024-02-01",
    dateTo: "2024-02-29",
    ...overrides,
  };
}

export function typeTotalsRequest(overrides = {}) {
  return {
    ...periodTotalsRequest(),
    currency: "USD",
    ...overrides,
  };
}

export function aggregateRow(overrides = {}) {
  return {
    currency: "USD",
    reported_amount: "1",
    service_fee: "0",
    company_amount: "1",
    row_count: "1",
    known_company_count: "1",
    ...overrides,
  };
}

export function assertRpcRequest(assert, url, init, endpoint) {
  assert.equal(new URL(url).pathname, `/rest/v1/rpc/${endpoint}`);
  assert.equal(new URL(url).search, "");
  assert.equal(init.method, "POST");
  assert.equal(new Headers(init.headers).get("Accept"), "application/json");
  assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-access");
  assert.equal(new Headers(init.headers).has("Prefer"), false);
  return JSON.parse(init.body);
}
