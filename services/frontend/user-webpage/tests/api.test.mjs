import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { parseTotalCount } from "../src/api/content-range.ts";
import { parseCsv } from "../src/api/csv.ts";
import { mapDatasetRows } from "../src/api/row-mappers.ts";
import { buildSearchFilter } from "../src/api/search.ts";

const SETTINGS = {
  supabaseUrl: "https://api.example.invalid",
  publishableKey: "sb_publishable_unit_test_key",
};
const SESSION = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1800000000,
  user: { id: "user-1", email: "member@example.invalid" },
};

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function datasetRecord(dataset, overrides = {}) {
  return Object.assign(
    Object.fromEntries(DATASET_CONFIG[dataset].selectColumns.map((column) => [column, column])),
    overrides,
  );
}

function csvRecord(record) {
  const columns = Object.keys(record);
  const cell = (value) => (value === null ? "" : `"${String(value).replaceAll('"', '""')}"`);
  return `${columns.join(",")}\n${columns.map((column) => cell(record[column])).join(",")}`;
}

function pageRequest(dataset = "live", overrides = {}) {
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

test("client configuration accepts public keys and rejects secret or service-role keys", () => {
  const legacyKey = (role) =>
    ["header", Buffer.from(JSON.stringify({ role })).toString("base64url"), "signature"].join(".");
  for (const publishableKey of [SETTINGS.publishableKey, legacyKey("anon")]) {
    assert.doesNotThrow(() => createApiClient({ ...SETTINGS, publishableKey }));
  }
  for (const publishableKey of [
    "sb_secret_must_not_reach_browser",
    legacyKey("service_role"),
    "",
  ]) {
    assert.throws(
      () => createApiClient({ ...SETTINGS, publishableKey }),
      /publishable key or legacy anon/,
    );
  }
});

test("company and SKU lookups advance by actual returned rows under a smaller server page cap", async () => {
  const rows = [0, 1, 2].map((index) => ({
    id: `identity-${index}`,
    name: `Company ${index}`,
    seller_namespace: "seller-test",
    sku: `SKU_${index}`,
    company_id: "company-a",
    terms_version_id: `version-${index}`,
  }));
  for (const method of ["fetchCompanies", "fetchSkuAssignments"]) {
    const offsets = [];
    const client = createApiClient(SETTINGS, async (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      offsets.push(offset);
      const page = rows.slice(offset, offset + 2);
      return new Response(JSON.stringify(page), {
        status: 206,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `${offset}-${offset + page.length - 1}/3`,
        },
      });
    });
    assert.equal((await client[method]("test-access")).length, 3);
    assert.deepEqual(offsets, [0, 2]);
  }
});

test("datasets use current source, terms, payout, and application-account APIs", () => {
  assert.deepEqual(Object.keys(DATASET_CONFIG), [
    "live",
    "settlement",
    "data_kiosk",
    "fees",
    "payouts",
    "accounts",
  ]);
  assert.equal(DATASET_CONFIG.live.endpoint, "live_company_components");
  assert.equal(DATASET_CONFIG.fees.endpoint, "current_sku_fee_periods");
  assert.equal(DATASET_CONFIG.payouts.endpoint, "company_payout_reports");
  assert.equal(DATASET_CONFIG.accounts.endpoint, "app_accounts");
  assert.deepEqual(DATASET_CONFIG.live.idColumns, ["source", "source_row_id"]);
  assert.deepEqual(DATASET_CONFIG.fees.idColumns, ["fee_period_id"]);
  assert.deepEqual(DATASET_CONFIG.accounts.idColumns, ["user_id"]);
});

test("free-text search excludes enum, date, UUID, and numeric columns", () => {
  const nonTextColumns = new Set([
    "marketplace_name",
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
  for (const config of Object.values(DATASET_CONFIG)) {
    for (const column of config.searchColumns)
      assert.equal(nonTextColumns.has(column), false, `${config.endpoint}: ${column}`);
    for (const column of config.idColumns)
      assert.ok(config.selectColumns.includes(column), `${config.endpoint}: ${column}`);
  }
  assert.deepEqual(DATASET_CONFIG.fees.searchColumns, []);
  assert.deepEqual(DATASET_CONFIG.accounts.searchColumns, []);
});

test("Content-Range supports successful, empty, unknown, and out-of-range counts", () => {
  assert.equal(parseTotalCount("0-24/129"), 129);
  assert.equal(parseTotalCount("*/0"), 0);
  assert.equal(parseTotalCount("*/10"), 10);
  assert.equal(parseTotalCount("0-24/*"), null);
  assert.equal(parseTotalCount(null), null);
  assert.throws(() => parseTotalCount("invalid"), /invalid Content-Range/);
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

test("206 CSV pages retain exact money and stable dataset-specific ordering", async () => {
  for (const dataset of Object.keys(DATASET_CONFIG)) {
    let requested;
    const record = datasetRecord(dataset);
    const client = createApiClient(SETTINGS, async (url, init) => {
      requested = { url: new URL(url), init };
      return new Response(csvRecord(record), {
        status: 206,
        headers: { "Content-Range": "25-25/129", "Content-Type": "text/csv" },
      });
    });
    const result = await client.fetchDatasetPage(pageRequest(dataset, { pageIndex: 1 }));
    assert.equal(result.totalCount, 129);
    assert.equal(result.rows.length, 1);
    assert.equal(requested.url.searchParams.get("offset"), "25");
    assert.equal(requested.url.searchParams.get("limit"), "25");
    const orderedColumns = requested.url.searchParams
      .get("order")
      .split(",")
      .map((term) => term.split(".")[0]);
    assert.equal(new Set(orderedColumns).size, orderedColumns.length);
    for (const column of DATASET_CONFIG[dataset].idColumns)
      assert.ok(orderedColumns.includes(column));
    assert.equal(new Headers(requested.init.headers).get("Accept"), "text/csv");
    assert.equal(new Headers(requested.init.headers).get("Authorization"), "Bearer test-access");
  }
});

test("416 page responses retain the count needed to clamp pagination", async () => {
  const client = createApiClient(
    SETTINGS,
    async () => new Response("", { status: 416, headers: { "Content-Range": "*/10" } }),
  );
  assert.deepEqual(await client.fetchDatasetPage(pageRequest("live", { pageIndex: 9 })), {
    rows: [],
    totalCount: 10,
  });
});

test("invalid local pagination and sorting fail before any HTTP request", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return responseJson([]);
  });
  for (const overrides of [
    { pageIndex: -1 },
    { pageSize: 0 },
    { pageIndex: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { sort: { column: "removed_legacy_column", direction: "asc" } },
  ]) {
    await assert.rejects(client.fetchDatasetPage(pageRequest("live", overrides)));
  }
  assert.equal(requests, 0);
});

test("forbidden source reads are errors rather than successful empty pages", async () => {
  const client = createApiClient(SETTINGS, async () =>
    responseJson({ message: "private source details" }, 403),
  );
  await assert.rejects(
    client.fetchDatasetPage(pageRequest()),
    (error) => /403/.test(error.message) && !error.message.includes("private source details"),
  );
});

test("own account lookup filters the authenticated identity even for operators", async () => {
  let requested;
  const account = { user_id: "operator-id", access_role: "operator", company_id: null };
  const client = createApiClient(SETTINGS, async (url) => {
    requested = new URL(url);
    return responseJson([account]);
  });
  assert.deepEqual(await client.fetchAppAccount("test-access", "operator-id"), account);
  assert.equal(requested.searchParams.get("user_id"), "eq.operator-id");
  assert.equal(requested.pathname, "/rest/v1/app_accounts");
});

test("an Auth user without an application account does not gain a default role", async () => {
  const client = createApiClient(SETTINGS, async () => responseJson([]));
  await assert.rejects(
    client.fetchAppAccount("test-access", "unregistered-user"),
    /no application access/,
  );
});

test("sign out revokes only the current session", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return new Response(null, { status: 204 });
  });
  await client.signOut("test-access");
  assert.equal(requested.url.pathname, "/auth/v1/logout");
  assert.equal(requested.url.searchParams.get("scope"), "local");
  assert.equal(new Headers(requested.init.headers).get("Authorization"), "Bearer test-access");
});

test("Auth refresh uses its refresh grant and does not leak HTTP error bodies", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return responseJson(SESSION);
  });
  assert.deepEqual(await client.refreshSession("test-refresh"), SESSION);
  assert.equal(requested.url.searchParams.get("grant_type"), "refresh_token");
  assert.deepEqual(JSON.parse(requested.init.body), { refresh_token: "test-refresh" });
  const failing = createApiClient(SETTINGS, async () =>
    responseJson({ message: "private response detail" }, 401),
  );
  await assert.rejects(
    failing.refreshSession("test-refresh"),
    (error) => /401/.test(error.message) && !error.message.includes("private response detail"),
  );
});
