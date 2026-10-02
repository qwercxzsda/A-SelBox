import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth } from "./table-actions.mjs";
import {
  REVIEW_REPORT,
  reviewAmounts,
  setupFinancialReview,
  setupManyFinancialReviewRows,
} from "./financial-review-fixtures.mjs";

async function openReview(page, configure = () => {}) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  configure(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  return fixture;
}
const categories = (page) => page.getByRole("tablist", { name: "Financial review", exact: true });
const monthTable = (page) =>
  page.getByRole("table", { name: "Monthly financial review", exact: true });
const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const totalsTable = (page) =>
  drawer(page).getByRole("table", { name: "Financial review by currency", exact: true });
const typesTable = (page) =>
  drawer(page).getByRole("table", { name: "Amounts by type", exact: true });
const recordsTable = (page) =>
  drawer(page).getByRole("table", { name: "Source records", exact: true });
const monthGroup = (page, month) => monthTable(page).getByRole("rowgroup", { name: month });
const currencyRow = (table, page, currency) =>
  table.getByRole("row").filter({ has: page.getByRole("cell", { name: currency, exact: true }) });
const pages = (page) =>
  page.getByRole("navigation", { name: "Monthly summaries pagination", exact: true });
const currentReads = (fixture, endpoint) =>
  fixture.financialReviewRequests.filter(
    (entry) =>
      entry.params.get("select") !== "activity_date" && (!endpoint || entry.endpoint === endpoint),
  );
const categoryFilter = (params) => params.get("p_category") ?? params.get("category")?.slice(3);
async function selectMonth(page, month = "July 2026") {
  await monthTable(page)
    .getByRole("button", { name: `Open review for ${month}`, exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: month, exact: true })).toBeVisible();
}
async function selectCurrency(page, currency = "USD") {
  await drawer(page).getByLabel("Review currency", { exact: true }).selectOption(currency);
}
async function openRecords(page) {
  const toggle = drawer(page).getByRole("button", { name: "Source records", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(recordsTable(page)).toBeVisible();
}
async function closeReview(page) {
  await drawer(page)
    .getByRole("button", { name: "Close monthly financial review", exact: true })
    .click();
}
async function checkForUpdates(page, fixture) {
  const completed = () => fixture.revisionRequests.filter(({ completed }) => completed).length;
  const before = completed();
  await page.clock.fastForward(60_000);
  await expect.poll(completed).toBeGreaterThan(before);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}
function addOlderMonths(fixture) {
  for (const month of ["2026-01-01", "2024-09-01", "2024-03-01"])
    fixture.financialReviewTotals.push({
      month,
      currency: "USD",
      ...reviewAmounts({ difference: "-7.5" }),
    });
}

test("three category summaries preserve currency and zero amounts and defer source records and saved snapshots", async ({
  page,
}) => {
  const fixture = await openReview(page);
  await expect(categories(page).getByRole("tab")).toHaveText([
    "Settlement",
    "Data Kiosk",
    "SelBox",
  ]);
  await expect(
    categories(page).getByRole("tab", { name: "Data Kiosk", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Saved source details", exact: true })).toHaveCount(0);
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(3);
  await expect(
    currencyRow(monthGroup(page, "July 2026"), page, "USD").getByRole("cell"),
  ).toContainText(["USD", "-100.25", "-101.5", "1.25"]);
  await expect(
    currencyRow(monthGroup(page, "July 2026"), page, "EUR").getByRole("cell"),
  ).toContainText(["EUR", "-10", "-10", "0"]);
  expect(
    currentReads(fixture).every(
      ({ endpoint, params }) =>
        endpoint === "financial_review_totals" && categoryFilter(params) === "DATA_KIOSK",
    ),
  ).toBe(true);
  await selectMonth(page);
  await selectCurrency(page);
  await expect(totalsTable(page).locator("tbody tr")).toHaveCount(2);
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(2);
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  expect(fixture.payoutComponentRequests).toHaveLength(0);
  expect(fixture.requests.some(({ dataset }) => dataset === "payouts")).toBe(false);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await expect(
    recordsTable(page).getByRole("cell", { name: "0", exact: true }).first(),
  ).toBeVisible();
  await expect(
    recordsTable(page).getByRole("cell", { name: "seller-east", exact: true }).first(),
  ).toBeVisible();
  const request = currentReads(fixture, "financial_review_records").at(-1);
  expect(request.params.get("and")).toBe(
    "(activity_date.gte.2026-07-01,activity_date.lte.2026-07-31)",
  );
  expect(request.params.get("category")).toBe("eq.DATA_KIOSK");
  expect(request.params.get("currency")).toBe("eq.USD");
  for (const field of ["sku", "company_id", "seller_namespace", "marketplace_name"])
    expect(request.params.has(field)).toBe(false);
});

test("each category has its own month filter and cursor, including source gaps", async ({
  page,
}) => {
  const fixture = await openReview(page, addOlderMonths);
  await applyReportMonth(page, "2024-09");
  await expect(monthGroup(page, "September 2024")).toBeVisible();
  await categories(page).getByRole("tab", { name: "Settlement", exact: true }).click();
  await expect(monthGroup(page, "July 2026")).toBeVisible();
  await expect(
    currencyRow(monthGroup(page, "July 2026"), page, "USD").getByRole("cell"),
  ).toContainText(["USD", "500", "490", "10"]);
  await categories(page).getByRole("tab", { name: "SelBox", exact: true }).click();
  await expect(monthGroup(page, "July 2026").getByRole("row")).toHaveCount(1);
  await expect(monthGroup(page, "July 2026").getByRole("cell")).toContainText([
    "USD",
    "-20",
    "0",
    "-20",
  ]);
  await selectMonth(page);
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(1);
  await expect(
    drawer(page).getByText("Settlement: 1 records · Data Kiosk: 0 records", { exact: true }),
  ).toBeVisible();
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(categories(page).getByRole("tab", { name: "SelBox", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await closeReview(page);
  await categories(page).getByRole("tab", { name: "Data Kiosk", exact: true }).click();
  await expect(monthGroup(page, "September 2024")).toBeVisible();
  const categoriesRead = new Set(currentReads(fixture).map(({ params }) => categoryFilter(params)));
  expect(categoriesRead).toEqual(new Set(["DATA_KIOSK", "SETTLEMENT", "SELBOX"]));
});

test("selecting a type filters source records by exact source and type and F5 retains that context", async ({
  page,
}) => {
  const fixture = await openReview(page);
  await selectMonth(page);
  await selectCurrency(page);
  const type = typesTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "FBA storage fee", exact: true }) });
  await type.getByRole("button", { name: /^View records for / }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(26);
  let request = currentReads(fixture, "financial_review_records").at(-1);
  expect(request.params.get("source")).toBe("eq.DATA_KIOSK");
  expect(request.params.get("component_type")).toBe("eq.FBA_STORAGE_FEE");
  await page.reload();
  await expect(drawer(page).getByLabel("Review currency", { exact: true })).toHaveValue("USD");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(26);
  request = currentReads(fixture, "financial_review_records").at(-1);
  expect(request.params.get("source")).toBe("eq.DATA_KIOSK");
  expect(request.params.get("component_type")).toBe("eq.FBA_STORAGE_FEE");
  await drawer(page).getByRole("button", { name: "Clear selected type", exact: true }).click();
  await drawer(page).getByLabel("Record source", { exact: true }).selectOption("");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await selectCurrency(page, "EUR");
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(2);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(2);
  expect(currentReads(fixture, "financial_review_records").at(-1).params.get("currency")).toBe(
    "eq.EUR",
  );
});

test("month rows support keyboard navigation and moving between months keeps the drawer context", async ({
  page,
}) => {
  await openReview(page);
  const june = currencyRow(monthGroup(page, "June 2026"), page, "USD");
  await june.focus();
  await june.press("Enter");
  await expect(drawer(page).getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
  await expect(totalsTable(page).getByRole("cell", { name: "12.5", exact: true })).toBeVisible();
  await drawer(page)
    .getByRole("navigation", { name: "Review months on this page", exact: true })
    .getByRole("button", { name: "Previous", exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await drawer(page)
    .getByRole("navigation", { name: "Review months on this page", exact: true })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
  await closeReview(page);
  await june.focus();
  await june.press("Space");
  await expect(drawer(page)).toBeVisible();
});

test("long type lists page independently of source records and retain position after F5", async ({
  page,
}) => {
  const fixture = await openReview(page, (state) => {
    const example = state.financialReviewTypeTotals.find(
      (row) =>
        row.category === "DATA_KIOSK" && row.currency === "USD" && row.month === "2026-07-01",
    );
    state.financialReviewTypeTotals = [
      ...state.financialReviewTypeTotals.filter(
        (row) =>
          row.category !== "DATA_KIOSK" || row.currency !== "USD" || row.month !== "2026-07-01",
      ),
      ...Array.from({ length: 51 }, (_, index) => ({
        ...example,
        component_type: `SYNTHETIC_FEE_${String(index).padStart(2, "0")}`,
      })),
    ];
  });
  await selectMonth(page);
  await selectCurrency(page);
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(50);
  await drawer(page).getByRole("button", { name: "Next amounts by type", exact: true }).click();
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(1);
  const request = currentReads(fixture, "financial_review_type_totals").at(-1);
  expect(request.params.get("offset")).toBe("50");
  expect(request.params.get("p_currency")).toBe("USD");
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  expect(currentReads(fixture, "financial_review_records").at(-1).params.get("offset")).toBe("0");
});

test("a long EPR type stays clearable on a phone and keyboard selection reaches its source records", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const type =
    "AmazonFees/Eco-contribution for EPR Pay on Behalf - GB - Packaging - (Period 01.07.2024 - 31.12.2024)/Base fee";
  await openReview(page, (fixture) => {
    for (const row of [...fixture.financialReviewTypeTotals, ...fixture.financialReviewRecords])
      if (row.category === "SELBOX") row.component_type = type;
  });
  await categories(page).getByRole("tab", { name: "SelBox", exact: true }).click();
  await selectMonth(page);
  const action = typesTable(page).getByRole("button", { name: /^View records for / });
  await action.focus();
  await action.press("Enter");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await expect(
    drawer(page).getByRole("region", { name: "Source records", exact: true }),
  ).toBeFocused();
  const clear = drawer(page).getByRole("button", { name: "Clear selected type", exact: true });
  await expect(clear).toBeInViewport();
  await expect
    .poll(async () => {
      const bounds = await clear.boundingBox();
      return bounds.x + bounds.width;
    })
    .toBeLessThanOrEqual(390);
  const remove = clear.getByText("×", { exact: true });
  await expect(remove).toBeInViewport();
  const clearBounds = await clear.boundingBox();
  const removeBounds = await remove.boundingBox();
  expect(removeBounds.x + removeBounds.width).toBeLessThanOrEqual(
    clearBounds.x + clearBounds.width,
  );
  await page.screenshot({
    path: testInfo.outputPath("phone-epr-source-filter.png"),
    animations: "disabled",
  });
  await clear.click();
  await expect(clear).toHaveCount(0);
});

test("F5 restores selected month, currency, and source page without persisting financial data", async ({
  page,
}) => {
  await openReview(page);
  await selectMonth(page);
  await selectCurrency(page);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await drawer(page).getByRole("button", { name: "Next source records", exact: true }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(drawer(page).getByLabel("Review currency", { exact: true })).toHaveValue("USD");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  const snapshots = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("aselbox.workspace."))
      .map(([, value]) => value)
      .join("\n"),
  );
  expect(snapshots).not.toContain("settlement_amount");
  expect(snapshots).not.toContain("source_version_id");
  await closeReview(page);
  await page.reload();
  await expect(monthTable(page)).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
});

test("row pages cross month boundaries and source gaps without omissions, with matching top and bottom controls", async ({
  page,
}) => {
  const fixture = await openReview(page, setupManyFinancialReviewRows);
  const selector = page.getByRole("combobox", { name: "Rows", exact: true });
  await expect(selector).toHaveValue("25");
  await expect(selector.locator("option")).toHaveText(["25", "50", "100"]);
  const navigation = page.getByRole("navigation", { name: /^Monthly summaries pagination/ });
  const actual = [];
  const expected = fixture.financialReviewTotals
    .filter(({ category }) => category === "DATA_KIOSK")
    .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency))
    .map(({ month, currency }) => `${month.slice(0, 7)}:${currency}`);
  for (let index = 0; index < 5; index++) {
    const count = index === 4 ? 15 : 25;
    await expect(monthTable(page).locator("tbody tr")).toHaveCount(count);
    await expect(navigation).toHaveCount(2);
    for (const bar of await navigation.all()) {
      await expect(bar.getByRole("button")).toHaveText(["Previous", "Next"]);
      await expect(bar).toContainText(
        index === 4 ? "101–115 of 115 rows" : `${index * 25 + 1}–${index * 25 + 25} rows`,
      );
      await expect(bar).not.toContainText(/202[0-9]/);
      if (index === 0)
        await expect(bar.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
      if (index === 4)
        await expect(bar.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    }
    actual.push(
      ...(await monthTable(page)
        .locator("tbody")
        .evaluateAll((groups) =>
          groups.flatMap((group) => {
            const month = group.querySelector("time").getAttribute("datetime");
            return [...group.querySelectorAll("tr")].map(
              (row) => `${month}:${row.querySelector("td").textContent.trim()}`,
            );
          }),
        )),
    );
    if (index < 4) {
      await navigation
        .nth(index % 2)
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(pages(page).getByRole("form")).toHaveAttribute(
        "aria-label",
        new RegExp(`^Page ${index + 2} of `),
      );
    }
  }
  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(115);
  await expect(monthGroup(page, "January 2020")).toBeVisible();
  await pages(page).getByRole("button", { name: "Previous", exact: true }).click();
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(25);
  await page.reload();
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 4 of /);
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(25);
  expect(
    fixture.financialReviewRequests.some(
      ({ params }) => params.get("limit") === "1" && params.get("select") === "activity_date",
    ),
  ).toBe(true);
  for (const { params } of currentReads(fixture, "financial_review_totals")) {
    expect(params.get("p_month_from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(params.get("p_month_to")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(params.get("p_month_from") < params.get("p_month_to")).toBe(true);
  }
});

test("Rows sizes and positions persist per category, reset paging, and retain the Month filter", async ({
  page,
}) => {
  await openReview(page, setupManyFinancialReviewRows);
  const selector = page.getByRole("combobox", { name: "Rows", exact: true });
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(25);
  await pages(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 2 of /);
  await selector.selectOption("50");
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 1 of /);
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(50);
  await pages(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(50);
  await page.reload();
  await expect(selector).toHaveValue("50");
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 2 of /);
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(50);
  await categories(page).getByRole("tab", { name: "Settlement", exact: true }).click();
  await expect(selector).toHaveValue("25");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(2);
  await selector.selectOption("100");
  await categories(page).getByRole("tab", { name: "Data Kiosk", exact: true }).click();
  await expect(selector).toHaveValue("50");
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 2 of /);
  await selector.selectOption("100");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(100);
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", /^Page 1 of /);
  await applyReportMonth(page, "2026-07");
  await expect(selector).toHaveValue("100");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(31);
  await selector.selectOption("25");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(25);
  await pages(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(6);
  await selectMonth(page);
  await page.reload();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await closeReview(page);
  await expect(selector).toHaveValue("25");
  await expect(pages(page)).toContainText("26–31 of 31 rows");
  await expect(
    page.getByRole("button", { name: "Clear month filter: July 2026", exact: true }),
  ).toBeVisible();
  await selector.selectOption("50");
  await expect(drawer(page)).toHaveCount(0);
  await expect(pages(page).getByRole("form")).toHaveAttribute("aria-label", "Page 1 of 1");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(31);
  await page.reload();
  await expect(drawer(page)).toHaveCount(0);
  await expect(selector).toHaveValue("50");
  await expect(
    page.getByRole("button", { name: "Clear month filter: July 2026", exact: true }),
  ).toBeVisible();
});

test("Month column finds a historical month, retains all currencies, and clearing it returns to latest", async ({
  page,
}) => {
  const fixture = await openReview(page, (state) => {
    addOlderMonths(state);
    state.financialReviewTotals.push({
      month: "2024-09-01",
      currency: "EUR",
      ...reviewAmounts({ difference: "0" }),
    });
  });
  await expect(monthGroup(page, "January 2026")).toBeVisible();
  const beforeFilter = currentReads(fixture).length;
  await applyReportMonth(page, "2024-09");
  await expect(monthGroup(page, "September 2024").getByRole("row")).toHaveCount(2);
  const clear = page.getByRole("button", {
    name: "Clear month filter: September 2024",
    exact: true,
  });
  await expect(clear).toBeVisible();
  for (const direction of ["Previous", "Next"])
    await expect(pages(page).getByRole("button", { name: direction, exact: true })).toBeDisabled();
  expect(
    currentReads(fixture)
      .slice(beforeFilter)
      .every(
        ({ endpoint, params }) =>
          endpoint === "financial_review_totals" &&
          params.get("p_month_from") === "2024-09-01" &&
          params.get("p_month_to") === "2024-10-01",
      ),
  ).toBe(true);
  await selectMonth(page, "September 2024");
  await page.reload();
  await expect(
    drawer(page).getByRole("heading", { name: "September 2024", exact: true }),
  ).toBeVisible();
  await expect(totalsTable(page).locator("tbody tr")).toHaveCount(2);
  await closeReview(page);
  await clear.click();
  await expect(monthGroup(page, "July 2026")).toBeVisible();
  await expect(pages(page).getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await page.reload();
  await expect(monthGroup(page, "July 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Clear month filter:/ })).toHaveCount(0);
});

test("an empty month keeps its filter reachable and another month remains selectable", async ({
  page,
}) => {
  const fixture = await openReview(page, addOlderMonths);
  await applyReportMonth(page, "2025-02");
  await expect(page.getByText(/No source data.*February 2025/)).toBeVisible();
  await expect(monthTable(page).getByRole("button", { name: "Month", exact: true })).toBeVisible();
  await expect(monthTable(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  for (const direction of ["Previous", "Next"])
    await expect(pages(page).getByRole("button", { name: direction, exact: true })).toBeDisabled();
  await applyReportMonth(page, "2024-09");
  await expect(monthGroup(page, "September 2024")).toBeVisible();
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
});

test("negative and high precision differences retain exact values without combining currencies", async ({
  page,
}) => {
  await openReview(page, (fixture) =>
    fixture.financialReviewTotals.push({
      month: "2026-07-01",
      currency: "GBP",
      ...reviewAmounts({
        settlement_amount: "-9007199254740993.123456789",
        data_kiosk_amount: "-9007199254740993",
        difference: "-0.123456789",
      }),
    }),
  );
  const gbp = currencyRow(monthGroup(page, "July 2026"), page, "GBP");
  await expect(
    gbp.getByRole("cell", { name: "-9,007,199,254,740,993.123456789", exact: true }),
  ).toBeVisible();
  await expect(gbp.getByRole("cell", { name: "-0.123456789", exact: true })).toBeVisible();
  await selectMonth(page);
  await expect(totalsTable(page).locator("tbody tr")).toHaveCount(3);
  await expect(
    totalsTable(page).getByRole("cell", { name: "-0.123456789", exact: true }),
  ).toBeVisible();
});

test("source and maturity revisions refresh visible review data while unchanged and fee checks stay lightweight", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openReview(page);
  await selectMonth(page);
  await selectCurrency(page);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  let reads = currentReads(fixture).length;
  await checkForUpdates(page, fixture);
  expect(currentReads(fixture)).toHaveLength(reads);
  fixture.financialReviewTotals[0].difference = "2.25";
  fixture.financialReviewRecords.find(
    (row) => row.activity_date === "2026-07-25" && row.currency === "USD",
  ).amount = "-97.25";
  fixture.revisions.settlement = "new-source";
  await checkForUpdates(page, fixture);
  await expect(totalsTable(page).getByRole("cell", { name: "2.25", exact: true })).toBeVisible();
  await expect(recordsTable(page).getByRole("cell", { name: "-97.25", exact: true })).toBeVisible();
  reads = currentReads(fixture).length;
  fixture.revisions.fees = "new-fees";
  await checkForUpdates(page, fixture);
  expect(currentReads(fixture)).toHaveLength(reads);
  fixture.payoutPolicy = {
    mature_cutoff_date: "2026-07-28",
    latest_month: "2026-06-01",
    mature_cutoff_months: 2,
  };
  fixture.financialReviewTotals[0].difference = "3.25";
  await checkForUpdates(page, fixture);
  await expect(totalsTable(page).getByRole("cell", { name: "3.25", exact: true })).toBeVisible();
  await expect(drawer(page).getByText(/Includes mature dates before 2026-07-28/)).toBeVisible();
  expect(fixture.payoutComponentRequests).toHaveLength(0);
  expect(fixture.reconciliationRequests).toHaveLength(0);
});

test("failed monthly and source reads retry locally without losing month or currency", async ({
  page,
}) => {
  const fixture = await openReview(page, (state) => {
    state.financialReviewStatusForRequest = ({ params }) =>
      params.get("limit") === "1" ? 200 : 503;
  });
  await expect(page.getByRole("alert")).toContainText("Could not load");
  fixture.financialReviewStatusForRequest = null;
  await page.getByRole("button", { name: "Retry monthly summaries", exact: true }).click();
  await expect(monthTable(page)).toBeVisible();
  await selectMonth(page);
  await selectCurrency(page);
  fixture.financialReviewStatusForRequest = ({ endpoint }) =>
    endpoint === "financial_review_records" ? 503 : 200;
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  await expect(drawer(page).getByRole("alert")).toContainText("Could not load");
  fixture.financialReviewStatusForRequest = null;
  await drawer(page).getByRole("button", { name: "Retry source records", exact: true }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
});

test("empty categories have no enabled pagination and company members never fetch review data", async ({
  page,
}) => {
  const fixture = await openReview(page, (state) => {
    state.financialReviewTotals = [];
  });
  await expect(
    page.getByText(/No source data available|No monthly source summaries/),
  ).toBeVisible();
  await expect(monthTable(page).getByRole("button", { name: "Month", exact: true })).toBeVisible();
  for (const direction of ["Previous", "Next"])
    await expect(pages(page).getByRole("button", { name: direction, exact: true })).toBeDisabled();
  await expect(drawer(page)).toHaveCount(0);
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const reads = currentReads(fixture).length;
  await signIn(page, "member-b");
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
  expect(currentReads(fixture)).toHaveLength(reads);
});

test("a failed maturity policy after F5 keeps retry reachable and restores the saved review", async ({
  page,
}) => {
  const fixture = await openReview(page);
  await selectMonth(page);
  fixture.payoutPolicyStatus = 503;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry available months", exact: true }),
  ).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
  fixture.payoutPolicyStatus = 200;
  await page.getByRole("button", { name: "Retry available months", exact: true }).click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await expect(totalsTable(page).getByRole("cell", { name: "1.25", exact: true })).toBeVisible();
});

for (const width of [1440, 1920, 834, 390]) {
  test(`monthly categories and source details remain usable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReview(page);
    await expect(monthTable(page)).toBeVisible();
    const fits = () =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      );
    await expect.poll(fits).toBe(true);
    if (width >= 1440) {
      const sizes = await monthTable(page).evaluate((element) => ({
        width: element.scrollWidth,
        wrapper: element.parentElement.clientWidth,
      }));
      expect(sizes.width).toBeLessThanOrEqual(sizes.wrapper + 1);
    }
    await page.screenshot({
      path: testInfo.outputPath(`monthly-list-${width}.png`),
      animations: "disabled",
    });
    await applyReportMonth(page, "2026-07");
    await selectMonth(page);
    await selectCurrency(page);
    await openRecords(page);
    await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
    await expect.poll(fits).toBe(true);
    if (width === 390) {
      const wrapper = drawer(page).getByRole("region", {
        name: "Source records table",
        exact: true,
      });
      await expect(wrapper).toHaveCSS("overflow-x", "auto");
      await wrapper.focus();
      await wrapper.press("ArrowRight");
      await expect.poll(() => wrapper.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    await page.screenshot({
      path: testInfo.outputPath(`monthly-detail-${width}.png`),
      animations: "disabled",
    });
  });
}

test("saved snapshots are scoped to the open month and preserve historical zeros and paging after F5", async ({
  page,
}) => {
  const fixture = await openReview(page);
  await selectMonth(page, "June 2026");
  await drawer(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await drawer(page).getByRole("cell", { name: "95 USD", exact: true }).click();
  const savedDrawer = page.getByRole("dialog", { name: "Saved source details", exact: true });
  const support = savedDrawer.getByRole("table", {
    name: "Supporting payout records",
    exact: true,
  });
  await expect(support.locator("tbody tr")).toHaveCount(50);
  await expect(
    support
      .getByRole("row")
      .filter({ hasText: "SUPPORT-00" })
      .getByRole("cell", { name: "0", exact: true }),
  ).toBeVisible();
  await expect(
    support.getByRole("columnheader", { name: /Company amount|Service fee/ }),
  ).toHaveCount(0);
  await savedDrawer.getByRole("button", { name: "Next supporting records", exact: true }).click();
  await expect(support.getByRole("cell", { name: "SUPPORT-50", exact: true })).toBeVisible();
  await page.reload();
  await expect(support.getByRole("cell", { name: "SUPPORT-50", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Saved source details", exact: true })).toHaveCount(0);
  expect(
    fixture.payoutComponentRequests.every(
      ({ reportId, authoritative }) => reportId === REVIEW_REPORT && authoritative === "false",
    ),
  ).toBe(true);
  const snapshotReads = fixture.requests.filter(({ dataset }) => dataset === "payouts");
  expect(snapshotReads.length).toBeGreaterThan(0);
  expect(
    snapshotReads.every(
      ({ params }) =>
        params.get("start_date") === "eq.2026-06-01" ||
        ["gte.2026-06-01", "lte.2026-06-01"].every((bound) =>
          params.getAll("start_date").includes(bound),
        ),
    ),
  ).toBe(true);
  await savedDrawer
    .getByRole("button", { name: "Saved account reconciliation", exact: true })
    .click();
  await expect(savedDrawer.getByRole("cell", { name: "EUR", exact: true })).toBeVisible();
  expect(fixture.reconciliationRequests.at(-1).params.get("report_id")).toBe(`eq.${REVIEW_REPORT}`);
  await savedDrawer
    .getByRole("button", { name: "Saved daily source details", exact: true })
    .click();
  const saved = savedDrawer.getByRole("table", { name: "Saved reconciliation", exact: true });
  await expect(saved.locator("tbody tr")).toHaveCount(50);
  await savedDrawer.getByRole("button", { name: "Next reconciliation", exact: true }).click();
  await expect(saved.locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(saved.locator("tbody tr")).toHaveCount(1);
});

test("Escape closes only the saved snapshot and returns focus to its monthly review", async ({
  page,
}) => {
  await openReview(page);
  await selectMonth(page, "June 2026");
  await drawer(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  const report = drawer(page)
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr.inspectable-row")
    .first();
  await report.focus();
  await report.press("Enter");
  const saved = page.getByRole("dialog", { name: "Saved source details", exact: true });
  await expect(saved).toBeVisible();
  await expect(
    saved.getByRole("table", { name: "Supporting payout records", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(saved).toHaveCount(0);
  await expect(
    drawer(page).getByRole("heading", { name: "June 2026", exact: true }).first(),
  ).toBeVisible();
  await expect(report).toBeFocused();
  await drawer(page)
    .getByRole("navigation", { name: "Review months on this page", exact: true })
    .getByRole("button", { name: "Previous", exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await drawer(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await expect(drawer(page).getByText("No payout reports yet", { exact: true })).toBeVisible();
  await expect(drawer(page).getByRole("cell", { name: "95 USD", exact: true })).toHaveCount(0);
  await expect(saved).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
});
