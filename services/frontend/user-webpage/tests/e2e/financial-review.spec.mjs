import { expect, test } from "@playwright/test";
import { openFinancialReview, checkFinancialReviewUpdates } from "./financial-review-actions.mjs";
import { signIn } from "./fixtures.mjs";
import { REVIEW_REPORT, reviewAmounts } from "./financial-review-fixtures.mjs";

const categories = (page) => page.getByRole("tablist", { name: "Financial review", exact: true });
const monthTable = (page) =>
  page.getByRole("table", { name: "Monthly financial review", exact: true });
const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const totalsTable = (page) =>
  drawer(page).getByRole("table", { name: "Financial review totals", exact: true });
const typesTable = (page) =>
  drawer(page).getByRole("table", { name: "Amounts by type", exact: true });
const recordsTable = (page) =>
  drawer(page).getByRole("table", { name: "Source records", exact: true });
const monthRow = (page, month) =>
  monthTable(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: `Open review for ${month}`, exact: true }),
    });
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
test("one-currency category summaries retain zero rows and defer source records and saved snapshots", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await expect(categories(page).getByRole("tab")).toHaveText(["Finances", "Data Kiosk", "SelBox"]);
  await expect(
    categories(page).getByRole("tab", { name: "Data Kiosk", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Year", exact: true })).toHaveValue("2026");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("USD");
  await expect(monthTable(page).locator("tbody tr")).toHaveCount(2);
  await expect(monthRow(page, "July 2026")).toContainText("-100.25");
  await expect(monthRow(page, "July 2026")).toContainText("-101.50");
  await expect(monthRow(page, "July 2026")).toContainText("13.75");
  await expect(monthTable(page)).not.toContainText("EUR");
  expect(
    currentReads(fixture).every(
      ({ endpoint, params }) =>
        (endpoint === "current_source_totals" ||
          (endpoint === "financial_review_type_totals" &&
            params.get("p_month_from") === "2026-01-01" &&
            params.get("p_month_to") === "2027-01-01")) &&
        categoryFilter(params) === "DATA_KIOSK",
    ),
  ).toBe(true);
  await selectMonth(page);
  await expect(totalsTable(page).locator("tbody tr")).toHaveCount(1);
  expect(currentReads(fixture, "current_source_totals").at(-1).params.get("p_currency")).toBe(
    "USD",
  );
  await expect(drawer(page).getByLabel("Review currency", { exact: true })).toHaveCount(0);
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(2);
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  expect(fixture.payoutRecordRequests).toHaveLength(0);
  expect(fixture.requests.some(({ dataset }) => dataset === "payouts")).toBe(false);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await expect(
    recordsTable(page).getByRole("cell", { name: "0.00", exact: true }).first(),
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
  expect(request.params.get("marketplace_name")).toBe("eq.Amazon.com");
  for (const field of ["sku", "company_id", "seller_namespace"])
    expect(request.params.has(field)).toBe(false);
});

test("selecting a type filters source records by exact source and type and F5 retains that context", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await selectMonth(page);
  const type = typesTable(page)
    .getByRole("row")
    .filter({
      has: page.locator(".transaction-type-label").filter({ hasText: /^FBA storage fee$/ }),
    });
  await type.getByRole("button", { name: /^View records for / }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(26);
  let request = currentReads(fixture, "financial_review_records").at(-1);
  expect(request.params.get("source")).toBe("eq.DATA_KIOSK");
  expect(request.params.get("component_type")).toBe("eq.FBA_STORAGE_FEE");
  await page.reload();
  await expect(
    drawer(page).getByRole("region", { name: "Account totals", exact: true }),
  ).toContainText("USD");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(26);
  request = currentReads(fixture, "financial_review_records").at(-1);
  expect(request.params.get("source")).toBe("eq.DATA_KIOSK");
  expect(request.params.get("component_type")).toBe("eq.FBA_STORAGE_FEE");
  await closeReview(page);
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("EUR");
  await selectMonth(page);
  await openRecords(page);
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(2);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(2);
  expect(currentReads(fixture, "financial_review_records").at(-1).params.get("currency")).toBe(
    "eq.EUR",
  );
  await expect(
    drawer(page).getByRole("button", { name: "Clear selected type", exact: true }),
  ).toHaveCount(0);
  await closeReview(page);
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("USD");
  await selectMonth(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(26);
  await drawer(page).getByRole("button", { name: "Clear selected type", exact: true }).click();
  await drawer(page).getByLabel("Record source", { exact: true }).selectOption("");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
});

test("month rows support keyboard navigation and moving between months keeps the drawer context", async ({
  page,
}) => {
  await openFinancialReview(page);
  const june = monthRow(page, "June 2026");
  await june.focus();
  await june.press("Enter");
  await expect(drawer(page).getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
  await expect(totalsTable(page).getByRole("cell", { name: "12.50", exact: true })).toBeVisible();
  await drawer(page)
    .getByRole("navigation", { name: /^Review months/ })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await drawer(page)
    .getByRole("navigation", { name: /^Review months/ })
    .getByRole("button", { name: "Previous", exact: true })
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
  const fixture = await openFinancialReview(page, (state) => {
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
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(50);
  await drawer(page).getByRole("button", { name: "Next amounts by type", exact: true }).click();
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(typesTable(page).locator("tbody tr")).toHaveCount(1);
  const request = currentReads(fixture, "financial_review_type_totals")
    .filter(
      ({ params }) =>
        params.get("p_month_from") === "2026-07-01" && params.get("p_month_to") === "2026-08-01",
    )
    .at(-1);
  expect(request.params.get("offset")).toBe("50");
  expect(request.params.get("p_currency")).toBe("USD");
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  expect(currentReads(fixture, "financial_review_records").at(-1).params.get("offset")).toBe("0");
});

test("a long unfamiliar type stays clearable on a phone and keyboard selection reaches its source records", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const type = "UNRECOGNIZED_FINANCIAL_ADJUSTMENT_".repeat(8);
  await openFinancialReview(page, (fixture) => {
    for (const row of [...fixture.financialReviewTypeTotals, ...fixture.financialReviewRecords])
      if (row.category === "SELBOX") row.component_type = type;
  });
  await categories(page).getByRole("tab", { name: "SelBox", exact: true }).click();
  await selectMonth(page);
  const action = typesTable(page).getByRole("button", { name: /^View records for / });
  await action.focus();
  await action.press("Enter");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await expect(recordsTable(page).getByRole("cell", { name: "No SKU", exact: true })).toBeVisible();
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
  await openFinancialReview(page);
  await selectMonth(page);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await drawer(page).getByRole("button", { name: "Next source records", exact: true }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    drawer(page).getByRole("region", { name: "Account totals", exact: true }),
  ).toContainText("USD");
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(1);
  const snapshots = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("aselbox.workspace."))
      .map(([, value]) => value)
      .join("\n"),
  );
  expect(snapshots).not.toContain("finances_amount");
  expect(snapshots).not.toContain("source_version_id");
  await closeReview(page);
  await page.reload();
  await expect(monthTable(page)).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
});

test("negative and high precision differences round for display without combining currencies", async ({
  page,
}) => {
  await openFinancialReview(page, (fixture) =>
    fixture.financialReviewTotals.push({
      month: "2026-07-01",
      currency: "GBP",
      ...reviewAmounts({
        finances_amount: "-9007199254740993.123456789",
        data_kiosk_amount: "-9007199254740993",
        difference: "-0.123456789",
      }),
    }),
  );
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("GBP");
  const gbp = monthRow(page, "July 2026");
  await expect(
    gbp.getByRole("cell", { name: "-9,007,199,254,740,993.12", exact: true }),
  ).toBeVisible();
  await expect(gbp.getByRole("cell", { name: "-0.12", exact: true })).toHaveCount(2);
  await selectMonth(page);
  await expect(totalsTable(page).locator("tbody tr")).toHaveCount(1);
  await expect(totalsTable(page).getByRole("cell", { name: "-0.12", exact: true })).toBeVisible();
});

test("source revisions refresh visible review data while unchanged and fee checks stay lightweight", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openFinancialReview(page);
  await selectMonth(page);
  await openRecords(page);
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  let reads = currentReads(fixture).length;
  await checkFinancialReviewUpdates(page, fixture);
  expect(currentReads(fixture)).toHaveLength(reads);
  fixture.financialReviewTotals[0].finances_amount = "-99.25";
  fixture.financialReviewRecords.find(
    (row) => row.activity_date === "2026-07-25" && row.currency === "USD",
  ).amount = "-97.25";
  fixture.revisions.finances = "new-source";
  await checkFinancialReviewUpdates(page, fixture);
  await expect(totalsTable(page).getByRole("cell", { name: "2.25", exact: true })).toBeVisible();
  await expect(recordsTable(page).getByRole("cell", { name: "-97.25", exact: true })).toBeVisible();
  reads = currentReads(fixture).length;
  fixture.revisions.fees = "new-fees";
  await checkFinancialReviewUpdates(page, fixture);
  expect(currentReads(fixture)).toHaveLength(reads);
  fixture.financialReviewTotals[0].finances_amount = "-98.25";
  fixture.revisions.data_kiosk = "another-source-change";
  await checkFinancialReviewUpdates(page, fixture);
  await expect(totalsTable(page).getByRole("cell", { name: "3.25", exact: true })).toBeVisible();
  expect(fixture.payoutRecordRequests).toHaveLength(0);
  expect(fixture.reconciliationRequests).toHaveLength(0);
  await closeReview(page);
  await expect(page.getByText("Mature dates only", { exact: true })).toHaveCount(0);
  await expect(monthRow(page, "July 2026").getByRole("cell").last()).toHaveText("15.75");
});

test("a changed source revision during aggregate loading refreshes the comparison together", async ({
  page,
}) => {
  let changed = false;
  const fixture = await openFinancialReview(page, (state) => {
    state.beforeFinancialReview = async ({ endpoint }) => {
      if (endpoint !== "current_source_totals" || changed) return;
      changed = true;
      state.revisions.finances = "changed-during-aggregate";
      state.financialReviewTotals[0].finances_amount = "-99.25";
    };
  });
  await expect(monthRow(page, "July 2026")).toContainText("2.25");
  await expect.poll(() => currentReads(fixture, "current_source_totals").length).toBeGreaterThan(1);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
});

test("retrieved empty monthly data stays distinct from an unavailable counterpart", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await expect(monthRow(page, "July 2026")).toBeVisible();
  fixture.financialReviewTotals = fixture.financialReviewTotals.filter(
    (row) => row.month !== "2026-07-01" || row.category !== "DATA_KIOSK" || row.currency !== "USD",
  );
  fixture.currentSourceCoverage = [
    {
      source: "FINANCES",
      seller_namespace: "seller-one",
      start_date: "2026-07-01",
      end_date: "2026-07-31",
    },
  ];
  await selectMonth(page);
  await expect(totalsTable(page).locator("tbody tr").getByRole("cell")).toHaveText([
    "0.00",
    "—",
    "—",
  ]);
  await expect(drawer(page)).toContainText("Source retrieval coverage is incomplete");
});

test("failed monthly and source reads retry locally without losing month or currency", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, (state) => {
    state.financialReviewStatusForRequest = ({ params }) =>
      params.get("limit") === "1" ? 200 : 503;
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load monthly summaries" }),
  ).toBeVisible();
  fixture.financialReviewStatusForRequest = null;
  await page.getByRole("button", { name: "Retry monthly summaries", exact: true }).click();
  await expect(monthTable(page)).toBeVisible();
  await selectMonth(page);
  fixture.financialReviewStatusForRequest = ({ endpoint }) =>
    endpoint === "financial_review_records" ? 503 : 200;
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  await expect(drawer(page).getByRole("alert")).toContainText("Could not load");
  fixture.financialReviewStatusForRequest = null;
  await drawer(page).getByRole("button", { name: "Retry source records", exact: true }).click();
  await expect(recordsTable(page).locator("tbody tr")).toHaveCount(50);
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
});

test("empty categories keep controls reachable and members never fetch review data", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, (state) => {
    state.financialReviewTotals = [];
  });
  await expect(page.getByText(/No source records for Amazon.com/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Marketplace", exact: true })).toHaveValue(
    "Amazon.com",
  );
  await expect(page.getByRole("combobox", { name: "Year", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /^Monthly summaries pagination/ })).toHaveCount(
    0,
  );
  await expect(drawer(page)).toHaveCount(0);
  expect(currentReads(fixture, "financial_review_records")).toHaveLength(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const reads = currentReads(fixture).length;
  await signIn(page, "member-b");
  await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
  expect(currentReads(fixture)).toHaveLength(reads);
});

test("failed available date bounds after F5 keeps retry reachable and restores the saved review", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await selectMonth(page);
  fixture.financialReviewStatusForRequest = ({ params }) =>
    params.get("select") === "activity_date" ? 503 : 200;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry available months", exact: true }),
  ).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
  fixture.financialReviewStatusForRequest = null;
  await page.getByRole("button", { name: "Retry available months", exact: true }).click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await expect(totalsTable(page).getByRole("cell", { name: "1.25", exact: true })).toBeVisible();
});

for (const width of [1440, 1920, 834, 390]) {
  test(`monthly categories and source details remain usable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await openFinancialReview(page);
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
    await selectMonth(page);
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
  const fixture = await openFinancialReview(page, (state) => {
    state.payoutRows.push({
      ...state.payoutRows[0],
      id: "0198b50b-701a-7000-8000-000000000043",
      currency: "EUR",
      company_amount: "999",
    });
  });
  await selectMonth(page, "June 2026");
  await drawer(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await expect(
    drawer(page).getByRole("table", { name: "Financial records", exact: true }).locator("tbody tr"),
  ).toHaveCount(1);
  await expect(drawer(page).getByRole("cell", { name: "999.00 EUR", exact: true })).toHaveCount(0);
  await drawer(page).getByRole("cell", { name: "95.00 USD", exact: true }).click();
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
      .getByRole("cell", { name: "0.00", exact: true }),
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
    fixture.payoutRecordRequests.every(
      ({ reportId, authoritative }) => reportId === REVIEW_REPORT && authoritative === "false",
    ),
  ).toBe(true);
  const snapshotReads = fixture.requests.filter(({ dataset }) => dataset === "payouts");
  expect(snapshotReads.length).toBeGreaterThan(0);
  expect(snapshotReads.every(({ params }) => params.get("currency") === "eq.USD")).toBe(true);
  expect(
    snapshotReads.every(
      ({ params }) =>
        params.get("start_date") === "eq.2026-06-01" ||
        ["gte.2026-06-01", "lte.2026-06-01"].every((bound) =>
          params.getAll("start_date").includes(bound),
        ),
    ),
  ).toBe(true);
  await savedDrawer.getByRole("button", { name: "Account reconciliation", exact: true }).click();
  await expect(savedDrawer.getByRole("cell", { name: "EUR", exact: true })).toHaveCount(0);
  expect(fixture.reconciliationRequests.at(-1).params.get("p_report_id")).toBe(REVIEW_REPORT);
  expect(fixture.reconciliationRequests.at(-1).params.get("p_grouping")).toBe("total");
  await savedDrawer.getByRole("button", { name: "Daily source details", exact: true }).click();
  const saved = savedDrawer.getByRole("table", { name: "Account reconciliation", exact: true });
  await expect(saved.locator("tbody tr")).toHaveCount(50);
  await savedDrawer.getByRole("button", { name: "Next reconciliation", exact: true }).click();
  await expect(saved.locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(saved.locator("tbody tr")).toHaveCount(1);
});

test("Escape closes only the saved snapshot and returns focus to its monthly review", async ({
  page,
}) => {
  await openFinancialReview(page);
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
    .getByRole("navigation", { name: /^Review months/ })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await drawer(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await expect(drawer(page).getByText("No payout reports yet", { exact: true })).toBeVisible();
  await expect(drawer(page).getByRole("cell", { name: "95.00 USD", exact: true })).toHaveCount(0);
  await expect(saved).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
});
