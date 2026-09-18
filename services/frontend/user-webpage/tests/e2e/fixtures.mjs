import { expect } from "@playwright/test";
import { DATA_KIOSK_COLUMNS, FEE_COLUMNS, csv } from "./api-fixtures.mjs";
import {
  filterRecordRows,
  optionColumn,
  projectedOptionRows,
  sortRecordRows,
} from "./record-fixtures.mjs";

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

export function liveRow(prefix, index, companyId = "company-member-a") {
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
    events: [],
    feeRequests: [],
    optionRequests: [],
    optionPageCap: 1000,
    assignments: [],
    kioskRows: [],
    feeRows: [],
    feePageCap: 1000,
    prefixes: { "member-a": "ALPHA", "member-b": "BRAVO" },
    roles: { "member-a": "company_member", "member-b": "company_member" },
    companyIds: { "member-a": "company-member-a", "member-b": "company-member-b" },
    companyNames: {
      "company-member-a": "Company A",
      "company-member-b": "Company B",
      "company-reassigned": "Company Reassigned",
    },
    authRequests: 0,
    totalCount: 30,
    searchCount: 1,
    liveRows: null,
    beforeDataset: async () => {},
    beforeAccount: async () => {},
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
    fixture.events.push({ endpoint: url.pathname, user });
    const csvReply = (columns, rows, total = rows.length, offset = 0) =>
      route.fulfill({
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Range": rows.length
            ? `${offset}-${offset + rows.length - 1}/${total}`
            : `*/${total}`,
        },
        contentType: "text/csv",
        body: csv(columns, rows),
      });
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
      await fixture.beforeAccount();
      const role = fixture.roles[user];
      return reply([
        {
          user_id: user,
          access_role: role,
          company_id: role === "operator" ? null : fixture.companyIds[user],
        },
      ]);
    }
    if (url.pathname === "/rest/v1/companies") {
      return reply(
        [{ id: fixture.companyIds[user], name: fixture.companyNames[fixture.companyIds[user]] }],
        200,
        {
          "Content-Range": "0-0/1",
        },
      );
    }
    if (url.pathname === "/rest/v1/company_skus") {
      const offset = Number(url.searchParams.get("offset"));
      const rows = fixture.assignments.slice(
        offset,
        offset + Number(url.searchParams.get("limit")),
      );
      return reply(rows, 200, {
        "Content-Range": rows.length
          ? `${offset}-${offset + rows.length - 1}/${fixture.assignments.length}`
          : `*/${fixture.assignments.length}`,
      });
    }
    if (url.pathname === "/rest/v1/current_sku_fee_periods") {
      fixture.feeRequests.push({ user, params: url.searchParams });
      const assignment = url.searchParams.get("seller_sku_id")?.replace("eq.", "");
      const rows = fixture.feeRows.filter((row) => row.seller_sku_id === assignment);
      const offset = Number(url.searchParams.get("offset"));
      const limit = Math.min(Number(url.searchParams.get("limit")), fixture.feePageCap);
      return csvReply(FEE_COLUMNS, rows.slice(offset, offset + limit), rows.length, offset);
    }
    if (url.pathname === "/rest/v1/data_kiosk_preprocess_entries") {
      const selectedColumn = optionColumn(url.searchParams);
      if (selectedColumn) {
        fixture.optionRequests.push({ user, params: url.searchParams, dataset: "data_kiosk" });
        const rows = projectedOptionRows(
          filterRecordRows(fixture.kioskRows, url.searchParams),
          selectedColumn,
          url.searchParams,
          fixture.optionPageCap,
        );
        return csvReply([selectedColumn], rows);
      }
      fixture.requests.push({ user, params: url.searchParams, dataset: "data_kiosk" });
      const rows = sortRecordRows(
        filterRecordRows(fixture.kioskRows, url.searchParams),
        url.searchParams,
      );
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return csvReply(DATA_KIOSK_COLUMNS, rows.slice(offset, offset + limit), rows.length, offset);
    }
    if (url.pathname !== "/rest/v1/live_company_components") {
      throw new Error(`Unexpected test API request: ${url.pathname}`);
    }

    const selectedColumn = optionColumn(url.searchParams);
    if (selectedColumn) {
      fixture.optionRequests.push({ user, params: url.searchParams, dataset: "live" });
      const allRows =
        fixture.liveRows ??
        Array.from({ length: fixture.totalCount }, (_, index) =>
          liveRow(fixture.prefixes[user], index + 1, fixture.companyIds[user]),
        );
      const rows = projectedOptionRows(
        filterRecordRows(allRows, url.searchParams),
        selectedColumn,
        url.searchParams,
        fixture.optionPageCap,
      );
      return csvReply([selectedColumn], rows);
    }

    const entry = { user, params: url.searchParams, dataset: "live" };
    fixture.requests.push(entry);
    const prefix = fixture.prefixes[user];
    await fixture.beforeDataset(entry);
    if (fixture.status !== 200) return reply({ message: "Denied fixture request" }, fixture.status);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const search = url.searchParams.get("or") ?? "";
    const filteredRows =
      fixture.liveRows === null
        ? undefined
        : sortRecordRows(filterRecordRows(fixture.liveRows, url.searchParams), url.searchParams);
    const count = filteredRows?.length ?? (search ? fixture.searchCount : fixture.totalCount);
    if (offset > 0 && offset >= count) {
      return reply({}, 416, { "Content-Range": `*/${count}` });
    }
    const rows =
      filteredRows?.slice(offset, offset + limit) ??
      Array.from({ length: Math.min(limit, Math.max(0, count - offset)) }, (_, index) =>
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
      body: csv(LIVE_COLUMNS, rows),
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

export async function captureResponsiveReview(page, testInfo, name, fullPage = true) {
  if (process.env.PLAYWRIGHT_CAPTURE_REVIEW !== "1") return;
  const initialViewport = page.viewportSize();
  await page.screenshot({
    path: testInfo.outputPath(`desktop-${name}.png`),
    fullPage,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath(`narrow-${name}.png`),
    fullPage,
    animations: "disabled",
  });
  await page.setViewportSize(initialViewport);
}
