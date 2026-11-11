import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, rowWithSku } from "./fixtures.mjs";
import { financesRow } from "./api-fixtures.mjs";
import { summaryBucket, summaryPeriods, summaryAmount } from "./summary-fixtures.mjs";
import {
  setupFinancialReview,
  setupManyFinancialReviewRows,
} from "./financial-review-fixtures.mjs";
import { columnTrigger } from "./table-actions.mjs";

test("marketplace totals remain explicit through filtering and reload, with a date entry point", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-08-01", "0"),
    summaryBucket("2026-07-31", "100", { currency: "JPY", marketplace: "Amazon.co.jp" }),
    summaryBucket("2026-07-31", "5"),
  ];
  await signIn(page);
  const { summaries, day, selected } = summaryPeriods(page, "Amazon.com");
  const japan = summaryPeriods(page, "Amazon.co.jp").day;

  await expect(
    summaryAmount(summaryPeriods(page, "Amazon.co.jp").day, "Reported amount", "JPY"),
  ).toHaveText("100.00 JPY");

  await expect(summaryAmount(day, "Reported amount")).toHaveText("5.00 USD");
  await expect(summaries.getByRole("combobox")).toHaveCount(0);
  await columnTrigger(page, "Marketplace").click();
  const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
  await menu.getByRole("checkbox", { name: "Amazon.com", exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(japan).toHaveCount(0);

  await expect(summaryAmount(day, "Reported amount")).toHaveText("5.00 USD");
  await page.reload();
  await expect(japan).toHaveCount(0);

  await expect(summaryAmount(day, "Reported amount")).toHaveText("5.00 USD");

  await summaries.getByRole("button", { name: "Choose dates · UTC", exact: true }).click();
  const dates = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
  await dates.getByLabel("From date").fill("2026-07-01");
  await dates.getByLabel("To date").fill("2026-07-31");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();

  await expect(summaryAmount(selected, "Reported amount")).toHaveText("5.00 USD");

  await expect(
    selected.getByRole("button", {
      name: "View Selected dates for Amazon.com in USD by type",
      exact: false,
    }),
  ).toHaveAttribute("aria-haspopup", "dialog");
});

test("offline status distinguishes cached information from a paused new view and resumes automatically", async ({
  page,
  context,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [financesRow(1)];
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toContainText(
    "previously loaded",
  );
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(
    page.getByText("Waiting for a connection to load rows…", { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByText("Waiting for a connection to load rows…", { exact: true }),
  ).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toHaveCount(0);
});

test("desktop company amount and column context stay visible, with navigation below long lists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.totalCount = 150;
  await signIn(page);
  const amount = rowWithSku(page, "ALPHA-001").locator('[data-column="company_amount"]');
  const box = await amount.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  await page.getByLabel("Rows", { exact: true }).selectOption("100");
  await rowWithSku(page, "ALPHA-100").scrollIntoViewIfNeeded();
  await expect(page.locator(".floating-table-header")).toBeVisible();
  await expect(page.locator(".floating-table-header")).toContainText("Company amount");
  const footer = page.getByRole("navigation", { name: "Record navigation at bottom", exact: true });
  await footer.scrollIntoViewIfNeeded();
  await footer.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-101")).toBeVisible();
});

test("workspace URLs restore filters and support Back and Forward without storing fee drafts", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [financesRow(1)];
  await signIn(page);
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("ALPHA");
  await page.getByLabel("Rows", { exact: true }).selectOption("100");
  await expect(page).toHaveURL(/tab=live/);
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(page).toHaveURL(/tab=finances/);
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue("ALPHA");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("100");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue("ALPHA");
  await page.goForward();
  await expect(page.getByRole("tab", { name: "Finances", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("Financial review retains marketplace, category, year and amount unit after reloading another tab", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  setupManyFinancialReviewRows(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByLabel("Currency", { exact: true }).selectOption("JPY");
  await page.getByLabel("Year", { exact: true }).selectOption("2025");
  const categories = page.getByRole("tablist", { name: "Financial review", exact: true });
  await categories.getByRole("tab", { name: "Finances", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Monthly financial review", exact: true }),
  ).toContainText("No source records for Amazon.com in JPY in 2025.");
  await expect(page.getByLabel("Marketplace", { exact: true })).toHaveValue("Amazon.com");
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue("2025");
  await expect(categories.getByRole("tab", { name: "Finances", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
