import { expect } from "@playwright/test";
import { createFixtureState } from "./mocks/state.mjs";
import { createReplies, trackRequests } from "./mocks/http.mjs";
import { ACCOUNT_PATHS, createAccountHandlers } from "./mocks/accounts.mjs";
import { respondWithCount } from "./mocks/counts.mjs";
import { respondWithSourceRows } from "./mocks/source-rows.mjs";
import { respondWithLatestDate, respondWithSummary } from "./mocks/summaries.mjs";
import { respondWithTransactions } from "./mocks/transactions.mjs";
import { respondWithOptions } from "./mocks/options.mjs";
import { respondWithWorkspaceLists } from "./mocks/workspace-lists.mjs";
import { transactionPageParams } from "./transaction-page-fixtures.mjs";
import { respondWithPayouts } from "./mocks/payouts.mjs";
import { respondWithSkuConfiguration } from "./mocks/sku-configuration.mjs";

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Resolve either outcome, then remove both listeners so later requests cannot retain callbacks. */
export function waitForRequestSettled(page, matches) {
  return new Promise((resolve) => {
    const settled = (request) => {
      if (!matches(request)) return;
      page.off("requestfinished", settled);
      page.off("requestfailed", settled);
      resolve();
    };
    page.on("requestfinished", settled);
    page.on("requestfailed", settled);
  });
}

export async function mockSupabase(page) {
  const fixture = createFixtureState();
  const accounts = createAccountHandlers(fixture);
  const track = trackRequests(page);
  await page.route("https://example.invalid/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accessToken = request.headers().authorization?.replace("Bearer ", "");
    const user = accounts.userForToken(accessToken);
    const context = { request, url, user, accessToken, route, track, ...createReplies(route) };
    if (request.method() === "OPTIONS") return context.reply({});
    fixture.events.push({ endpoint: url.pathname, user });
    if (
      ["/rest/v1/rpc/sku_configuration", "/rest/v1/rpc/publish_sku_configuration"].includes(
        url.pathname,
      )
    )
      return respondWithSkuConfiguration(fixture, context);
    if (
      [
        "/rest/v1/rpc/payout_report_policy",
        "/rest/v1/rpc/generate_company_payout_reports",
        "/rest/v1/company_payout_report_components",
        "/rest/v1/payout_report_marketplace_totals",
        "/rest/v1/payout_report_reconciliation",
      ].includes(url.pathname)
    )
      return respondWithPayouts(fixture, context);
    if ([...url.searchParams.values()].some((value) => /\b(sum|count|avg|min|max)\(/.test(value)))
      throw new Error("REST aggregates are disabled; use a dedicated RPC");
    if (url.pathname === "/rest/v1/rpc/transaction_totals")
      return respondWithSummary(fixture, context);
    if (url.pathname === "/rest/v1/rpc/sku_filter_options")
      return respondWithOptions(fixture, context);
    if (
      ["/rest/v1/rpc/transaction_count", "/rest/v1/rpc/source_transaction_count"].includes(
        url.pathname,
      )
    )
      return respondWithCount(fixture, context);
    if (ACCOUNT_PATHS.has(url.pathname)) return accounts.respond(context);
    if (["/rest/v1/app_accounts", "/rest/v1/company_payout_reports"].includes(url.pathname))
      return respondWithWorkspaceLists(fixture, context);
    if (url.pathname === "/rest/v1/rpc/source_transaction_page")
      return respondWithSourceRows(fixture, context);
    if (url.pathname !== "/rest/v1/rpc/transaction_page")
      throw new Error(`Unexpected test API request: ${url.pathname}`);
    const args = request.postDataJSON();
    url.search = transactionPageParams(args).toString();
    if (args?.p_limit === 1 && args.p_include_count === false)
      return respondWithLatestDate(fixture, context, args);
    return respondWithTransactions(fixture, context, args);
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
