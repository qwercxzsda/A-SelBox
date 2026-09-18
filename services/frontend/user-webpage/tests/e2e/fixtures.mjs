import { expect } from "@playwright/test";

const LIVE_COLUMNS = [
  "source",
  "source_row_id",
  "source_version_id",
  "preprocess_version",
  "source_identity_id",
  "seller_namespace",
  "marketplace_name",
  "activity_date",
  "sku",
  "component_type",
  "currency",
  "source_amount",
  "quantity",
  "fee_base",
  "category",
  "authoritative",
  "seller_sku_id",
  "terms_version_id",
  "company_id",
  "fee_period_id",
  "fee_rate_percent",
  "resolution_status",
  "fee_amount",
  "company_amount",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range",
};

function liveRow(prefix, index, companyId) {
  return {
    source: "SETTLEMENT",
    source_row_id: `${prefix}-${index}`,
    source_version_id: "version-1",
    preprocess_version: "v0",
    seller_namespace: "synthetic-seller",
    marketplace_name: "Amazon.com",
    activity_date: "2026-09-01",
    sku: `${prefix}-${String(index).padStart(3, "0")}`,
    component_type: "PRINCIPAL",
    currency: "USD",
    source_amount: `${index}.123456789012345678`,
    quantity: "1",
    fee_base: "true",
    category: "SETTLEMENT",
    authoritative: "true",
    company_id: companyId,
    fee_rate_percent: "5",
    resolution_status: "APPLIED",
    fee_amount: "0.05",
    company_amount: "0.95",
  };
}

function csv(rows) {
  const quote = (value) =>
    value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return [
    LIVE_COLUMNS.join(","),
    ...rows.map((row) => LIVE_COLUMNS.map((key) => quote(row[key])).join(",")),
  ].join("\n");
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function mockSupabase(page) {
  const fixture = {
    requests: [],
    prefixes: { "member-a": "ALPHA", "member-b": "BRAVO" },
    companyIds: { "member-a": "company-member-a", "member-b": "company-member-b" },
    authRequests: 0,
    totalCount: 30,
    beforeDataset: async () => {},
    status: 200,
  };

  await page.route("https://example.invalid/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const user = request.headers().authorization?.replace("Bearer token-", "") ?? "member-a";
    const reply = (json, status = 200, extraHeaders = {}) =>
      route.fulfill({
        status,
        headers: { ...CORS_HEADERS, ...extraHeaders },
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    if (request.method() === "OPTIONS") return reply({}, 200);
    if (url.pathname === "/auth/v1/token") {
      fixture.authRequests += 1;
      const body = request.postDataJSON();
      const signedInUser = body.email?.split("@")[0] ?? body.refresh_token.replace("refresh-", "");
      return reply({
        access_token: `token-${signedInUser}`,
        refresh_token: `refresh-${signedInUser}`,
        token_type: "bearer",
        expires_in: 3600,
        user: { id: signedInUser, email: `${signedInUser}@example.test` },
      });
    }
    if (url.pathname === "/auth/v1/logout") return reply({});
    if (url.pathname === "/rest/v1/app_accounts") {
      return reply([
        { user_id: user, access_role: "company_member", company_id: fixture.companyIds[user] },
      ]);
    }
    if (url.pathname === "/rest/v1/companies") {
      return reply(
        [{ id: fixture.companyIds[user], name: `Company ${fixture.companyIds[user]}` }],
        200,
        {
          "Content-Range": "0-0/1",
        },
      );
    }
    if (url.pathname === "/rest/v1/company_skus") {
      return reply([], 200, { "Content-Range": "*/0" });
    }
    if (url.pathname !== "/rest/v1/live_company_components") {
      throw new Error(`Unexpected test API request: ${url.pathname}`);
    }

    const entry = { user, params: url.searchParams };
    fixture.requests.push(entry);
    const prefix = fixture.prefixes[user];
    await fixture.beforeDataset(entry);
    if (fixture.status !== 200) return reply({ message: "Denied fixture request" }, fixture.status);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const search = url.searchParams.get("or") ?? "";
    const count = search ? 1 : fixture.totalCount;
    if (offset > 0 && offset >= count) {
      return reply({}, 416, { "Content-Range": `*/${count}` });
    }
    const rows = Array.from({ length: Math.min(limit, Math.max(0, count - offset)) }, (_, index) =>
      liveRow(
        search.includes("FRESH") ? "FRESH" : search.includes("STALE") ? "STALE" : prefix,
        offset + index + 1,
        fixture.companyIds[user],
      ),
    );
    return route.fulfill({
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Range": rows.length
          ? `${offset}-${offset + rows.length - 1}/${count}`
          : `*/${count}`,
      },
      contentType: "text/csv",
      body: csv(rows),
    });
  });
  await page.goto("/");
  return fixture;
}

export async function signIn(page, user = "member-a") {
  await page.getByLabel(/^Email/).fill(`${user}@example.test`);
  await page.getByLabel(/^Password/).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

export function rowWithSku(page, sku) {
  return page.getByRole("row").filter({ has: page.getByRole("cell", { name: sku, exact: true }) });
}
