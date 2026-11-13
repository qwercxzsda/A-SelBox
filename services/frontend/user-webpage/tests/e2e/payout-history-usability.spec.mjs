import {
  payoutHistoryControls,
  payoutHistoryRows,
  payoutLatestRow,
  payoutScopeRows,
} from "./payout-history-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";

const COMPANY = "0198b50b-701a-7000-8000-000000000081";
const scope = "History Company · June 2026 · Amazon.com · USD";

async function setupHistory(page) {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = "History Company";
  fixture.payoutRows = Array.from({ length: 51 }, (_, index) => ({
    id: `0198b50b-701a-7000-8001-${String(index + 1).padStart(12, "0")}`,
    company_id: COMPANY,
    start_date: "2026-06-01",
    end_date: "2026-06-30",
    currency: "USD",
    created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, 51 - index)).toISOString(),
    source_amount: String(1000 + index),
    fee_amount: "-5",
    company_amount: String(995 + index),
  }));
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  const opener = page.getByRole("button", { name: `Show versions for ${scope}`, exact: true });
  await opener.scrollIntoViewIfNeeded();
  const table = page.getByRole("region", { name: "Financial table", exact: true });
  const history = payoutHistoryControls(page, scope);
  return { fixture, opener, table, history };
}

async function openHistory(page) {
  const { fixture, opener, history } = await setupHistory(page);
  await opener.click();
  await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
  return { fixture, history };
}

for (const width of [320, 390, 1440]) {
  test(`opening versions keeps the page and report columns stable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { opener, table, history } = await setupHistory(page);
    const response = deferred();
    await page.route("**/rest/v1/company_payout_reports?**", async (route) => {
      await response.promise;
      await route.fallback();
    });
    const position = () =>
      table.evaluate((element) => ({
        pageTop: globalThis.scrollY,
        tableLeft: element.scrollLeft,
        columns: [...element.querySelectorAll(".payout-reports-table > thead > tr > th")].map(
          (heading) => {
            const { x, width } = heading.getBoundingClientRect();
            return { x, width };
          },
        ),
      }));
    const before = await position();
    try {
      await opener.click();
      await expect(history.getByText("Loading report versions…", { exact: true })).toBeVisible();
      await expect(
        payoutLatestRow(page, scope).locator('[data-column="marketplace_name"]'),
      ).toHaveAttribute("rowspan", "2");
      expect(await position()).toEqual(before);
      response.resolve();
      await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
      await expect(
        payoutLatestRow(page, scope).locator('[data-column="marketplace_name"]'),
      ).toHaveAttribute("rowspan", "51");
      await expect(
        payoutScopeRows(page, scope).locator('[data-column="marketplace_name"]'),
      ).toHaveCount(1);
      expect(await position()).toEqual(before);
      await expect(table.locator("table")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: `Hide versions for ${scope}`, exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", { name: `Hide versions for ${scope}`, exact: true }),
      ).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`history-open-${width}.png`) });
    } finally {
      response.resolve();
    }
    await page.reload();
    await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
    await expect(history).not.toBeFocused();
  });
}

for (const width of [320, 390, 1440]) {
  test(`failed later report versions retain a way back and keyboard context at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { fixture, history } = await openHistory(page);
    await page.route("**/rest/v1/company_payout_reports?**", (route) => {
      const params = new URL(route.request().url()).searchParams;
      return params.get("offset") === "50"
        ? route.fulfill({ status: 403, contentType: "application/json", body: "{}" })
        : route.fallback();
    });
    const next = history.getByRole("button", { name: "Next", exact: true });
    await next.scrollIntoViewIfNeeded();
    await next.press("Enter");
    await expect(history.getByRole("alert")).toBeVisible();
    await expect(
      payoutLatestRow(page, scope).locator('[data-column="marketplace_name"]'),
    ).toHaveAttribute("rowspan", "2");
    await expect(history.locator("xpath=ancestor::td")).toHaveAttribute("colspan", "4");
    await expectFullyInViewport(
      history.getByRole("button", { name: "Retry versions", exact: true }),
    );
    const previous = history.getByRole("button", { name: "Previous", exact: true });
    await expect(previous).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`history-error-${width}.png`) });
    await previous.press("Enter");
    await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
    await expect(
      payoutLatestRow(page, scope).locator('[data-column="marketplace_name"]'),
    ).toHaveAttribute("rowspan", "51");
    await expect(history).toBeFocused();
    await expect(history).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`history-recovered-${width}.png`) });
    expect(
      fixture.requests
        .filter(({ endpoint }) => endpoint === "/rest/v1/company_payout_reports")
        .every(({ params }) => params.get("company_id") === `eq.${COMPANY}`),
    ).toBe(true);
  });
}

test("loading a later report-version page keeps focus on a stable history region", async ({
  page,
}) => {
  const { history } = await openHistory(page);
  const response = deferred();
  await page.route("**/rest/v1/company_payout_reports?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("offset") === "50") await response.promise;
    await route.fallback();
  });
  try {
    await history.getByRole("button", { name: "Next", exact: true }).press("Enter");
    await expect(
      history.getByRole("status").filter({ hasText: "Loading report versions…" }),
    ).toHaveText("Loading report versions…");
    await expect(history).toBeFocused();
    response.resolve();
    await expect(payoutHistoryRows(page, scope)).toHaveCount(1);
    await expect(history).toBeFocused();
  } finally {
    response.resolve();
  }
});
