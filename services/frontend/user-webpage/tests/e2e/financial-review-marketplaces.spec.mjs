import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { chooseFamilies } from "./financial-review-family-actions.mjs";
import {
  setupMarketplaceReview,
  MARKETPLACE_SOURCE_VERSION,
} from "./financial-review-marketplace-fixtures.mjs";
import { datasetRecord } from "../api-fixtures.mjs";

const marketplace = (page) => page.getByRole("combobox", { name: "Marketplace", exact: true });
const monthly = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const periodAmounts = (page) =>
  page
    .getByRole("region", { name: "2026 review totals", exact: true })
    .locator(".financial-review-summary-value");
const currentMonthRows = (page) =>
  page.getByRole("table", { name: "Monthly financial review", exact: true }).locator("tbody tr");

test("Germany and France stay separate in EUR and preserve family scope through reload and browser history", async ({
  page,
}, testInfo) => {
  const fixture = await openFinancialReview(page, setupMarketplaceReview);
  await marketplace(page).selectOption("Amazon.de");
  await expect(periodAmounts(page)).toHaveText(["-190.00 EUR", "-155.00 EUR", "-35.00 EUR"]);
  await expect(page.getByLabel("Amount currency: EUR", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveCount(0);
  await chooseFamilies(page, ["Monthly storage fees"]);
  await expect(periodAmounts(page)).toHaveText(["-150.00 EUR", "-130.00 EUR", "-20.00 EUR"]);
  await expect(currentMonthRows(page).first().locator("td")).toHaveText([
    "-100.00",
    "-90.00",
    "-10.00",
    "-10.00",
  ]);
  await expect(currentMonthRows(page).last().locator("td")).toHaveText([
    "-50.00",
    "-40.00",
    "-10.00",
    "-20.00",
  ]);
  await page.getByRole("button", { name: "Type family breakdown", exact: true }).click();
  const families = page.getByRole("table", { name: "Yearly type family breakdown", exact: true });
  await expect(families.locator("tbody tr")).toHaveCount(1);
  await expect(families.locator("tbody tr td:nth-child(n+2):nth-child(-n+4)")).toHaveText([
    "-150.00",
    "-130.00",
    "-20.00",
  ]);
  await marketplace(page).selectOption("Amazon.fr");
  await expect(periodAmounts(page)).toHaveText(["-7.00 EUR", "-3.00 EUR", "-4.00 EUR"]);
  await expect(currentMonthRows(page)).toHaveCount(1);
  await expect(families.locator("tbody tr td:nth-child(n+2):nth-child(-n+4)")).toHaveText([
    "-7.00",
    "-3.00",
    "-4.00",
  ]);
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["monthly-storage"]);
  await expect(page).toHaveURL(/reviewMarketplace=Amazon.fr/);
  await page.reload();
  await expect(marketplace(page)).toHaveValue("Amazon.fr");
  await expect(periodAmounts(page)).toHaveText(["-7.00 EUR", "-3.00 EUR", "-4.00 EUR"]);
  await page.goBack();
  await expect(marketplace(page)).toHaveValue("Amazon.de");
  await expect(periodAmounts(page)).toHaveText(["-150.00 EUR", "-130.00 EUR", "-20.00 EUR"]);
  await page.goForward();
  await expect(marketplace(page)).toHaveValue("Amazon.fr");
  await expect(periodAmounts(page)).toHaveText(["-7.00 EUR", "-3.00 EUR", "-4.00 EUR"]);
  for (const market of ["Amazon.de", "Amazon.fr"])
    await expect
      .poll(() =>
        fixture.financialReviewRequests.some(
          ({ endpoint, params, completed }) =>
            completed &&
            endpoint === "financial_review_type_totals" &&
            params.get("p_marketplace") === market &&
            params.get("p_currency") === "EUR",
        ),
      )
      .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("france-eur-storage-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("a marketplace with multiple currencies keeps amount units separate on a phone", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFinancialReview(page, setupMarketplaceReview);
  await expect(marketplace(page)).toHaveValue("Amazon.com");
  const currency = page.getByRole("combobox", { name: "Currency", exact: true });
  await expect(currency).toHaveValue("USD");
  await expect(periodAmounts(page)).toHaveText(["-15.00 USD", "-12.00 USD", "-3.00 USD"]);
  await currency.focus();
  await currency.press("Home");
  await expect(currency).toHaveValue("EUR");
  await expect(currency).toBeFocused();
  await expect(periodAmounts(page)).toHaveText(["-27.00 EUR", "-25.00 EUR", "-2.00 EUR"]);
  await chooseFamilies(page, ["Monthly storage fees"]);
  await expect(periodAmounts(page)).toHaveText(["-21.00 EUR", "-20.00 EUR", "-1.00 EUR"]);
  await page.reload();
  await expect(currency).toHaveValue("EUR");
  await expect(periodAmounts(page)).toHaveText(["-21.00 EUR", "-20.00 EUR", "-1.00 EUR"]);
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    )
    .toBe(true);
  await expectAccessible("marketplace-currency-phone");
  await page.screenshot({
    path: testInfo.outputPath("united-states-eur-storage-phone.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("monthly types, exact source records, and saved snapshots retain marketplace scope", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupMarketplaceReview);
  const sourceRequests = [];
  await page.route("**/rest/v1/rpc/financial_source_record", async (route) => {
    const args = route.request().postDataJSON();
    sourceRequests.push(args);
    const record = fixture.financialReviewRecords.find(
      (row) => row.source_row_id === args.p_row_id && row.source_version_id === args.p_version_id,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        record
          ? datasetRecord(args.p_source === "FINANCES" ? "finances" : "data_kiosk", {
              ...record,
              id: record.source_row_id,
              version_id: record.source_version_id,
              posted_date: record.activity_date,
              activity_eligible: "true",
            })
          : null,
      ),
    });
  });
  await marketplace(page).selectOption("Amazon.de");
  await chooseFamilies(page, ["Monthly storage fees"]);
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  await expect(monthly(page).locator(".detail-drawer-context")).toContainText("Amazon.de · EUR");
  await expect(
    monthly(page)
      .getByRole("table", { name: "Financial review totals", exact: true })
      .locator("tbody td"),
  ).toHaveText(["-100.00", "-90.00", "-10.00"]);
  await expect(monthly(page)).toContainText(
    "Amazon.de · Records in EUR · Finances: 1 · Data Kiosk: 1",
  );
  await expect(
    monthly(page).getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
  await monthly(page).getByRole("button", { name: "Source records", exact: true }).click();
  const records = monthly(page).getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(2);
  await expect(records.getByRole("cell", { name: "Amazon.de", exact: true })).toHaveCount(2);
  await expect(records).not.toContainText("ADVERTISING");
  const recordRequest = () =>
    fixture.financialReviewRequests.find(
      ({ endpoint, params, completed }) =>
        completed &&
        endpoint === "financial_review_records" &&
        params.get("marketplace_name") === "eq.Amazon.de" &&
        params.get("currency") === "eq.EUR" &&
        params.get("select") !== "activity_date",
    );
  await expect
    .poll(() => recordRequest()?.params.get("or"))
    .toContain('component_type.in.("STORAGE_FEES")');
  expect(recordRequest().params.get("or")).toContain('"FBA_STORAGE_FEE"');
  await records.locator("tbody tr.inspectable-row").first().click();
  const detail = page.getByRole("dialog", { name: "Data Kiosk record details", exact: true });
  await expect(detail.getByRole("heading", { name: /^Amazon.de-EUR-/ })).toBeVisible();
  expect(sourceRequests[0].p_version_id).toBe(MARKETPLACE_SOURCE_VERSION);
  const exactSource = sourceRequests[0];
  await page.keyboard.press("Escape");
  const opener = records.locator("tbody tr.inspectable-row").first();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(detail.getByRole("heading", { name: /^Amazon.de-EUR-/ })).toBeVisible();
  await page.reload();
  await expect(detail.getByRole("heading", { name: /^Amazon.de-EUR-/ })).toBeVisible();
  expect(sourceRequests.at(-1)).toEqual(exactSource);
  await page.keyboard.press("Escape");
  await expect(monthly(page)).toBeVisible();
  await monthly(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  const snapshots = monthly(page).getByRole("table", { name: "Financial records", exact: true });
  await expect(snapshots.locator("tbody tr")).toHaveCount(1);
  await expect(snapshots).toContainText("311.00 EUR");
  await expect(snapshots).not.toContainText("422.00 EUR");
  await expect
    .poll(() =>
      fixture.requests.some(
        ({ dataset, params, completed }) =>
          completed &&
          dataset === "payouts" &&
          params.get("marketplace_name") === 'in.("Amazon.de")' &&
          params.get("currency") === "eq.EUR",
      ),
    )
    .toBe(true);
  await monthly(page)
    .getByRole("button", { name: "Close monthly financial review", exact: true })
    .click();
  await marketplace(page).selectOption("Amazon.fr");
  await expect(periodAmounts(page)).toHaveText(["-7.00 EUR", "-3.00 EUR", "-4.00 EUR"]);
  await expect(monthly(page)).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get("month")).toBe(null);
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  await expect(
    monthly(page).getByRole("button", { name: "Source records", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toBeHidden();
  await expect(
    monthly(page)
      .getByRole("table", { name: "Financial review totals", exact: true })
      .locator("tbody td"),
  ).toHaveText(["-7.00", "-3.00", "-4.00"]);
  await monthly(page).getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await expect(snapshots.locator("tbody tr")).toHaveCount(1);
  await expect(snapshots).toContainText("422.00 EUR");
  await expect(snapshots).not.toContainText("311.00 EUR");
  await snapshots.getByRole("cell", { name: "422.00 EUR", exact: true }).first().click();
  const saved = page.getByRole("dialog", { name: "Saved report source details", exact: true });
  await expect(saved.locator(".detail-drawer-context")).toContainText("Amazon.fr · EUR");
  await page.reload();
  await expect(saved.locator(".detail-drawer-context")).toContainText("Amazon.fr · EUR");
  await expect(saved).toContainText("SAVED-Amazon.fr");
});
