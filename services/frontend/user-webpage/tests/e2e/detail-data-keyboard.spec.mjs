import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";

async function openRecords(page) {
  const fixture = await openFinancialReview(page);
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await drawer.getByRole("button", { name: "Source records", exact: true }).click();
  const table = drawer.getByRole("table", { name: "Source records", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(50);
  const results = drawer.getByRole("group", { name: "source records", exact: true });
  return { fixture, drawer, table, results };
}

test("detail page navigation retains a stable focus target through loading and cached pages", async ({
  page,
}) => {
  const { fixture, drawer, table, results } = await openRecords(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeFinancialReview = async (entry) => {
    if (entry.endpoint === "financial_review_records" && entry.params.get("offset") === "50") {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await drawer
      .getByRole("button", { name: "Next source records at bottom", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await started.promise;
    await expect(drawer.getByText("Loading source records…", { exact: true })).toBeVisible();
    await expect(results).toBeFocused();
    release.resolve();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(results).toBeFocused();
    await drawer.getByRole("button", { name: "Previous source records", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(results).toBeFocused();
    await expect(
      drawer.getByRole("navigation", { name: "Pagination for source records", exact: true }),
    ).toBeInViewport();
  } finally {
    release.resolve();
  }
});

test("detail query recovery keeps keyboard focus in the recovered records", async ({ page }) => {
  const { fixture, drawer, table, results } = await openRecords(page);
  fixture.financialReviewStatusForRequest = (entry) =>
    entry.endpoint === "financial_review_records" && entry.params.get("offset") === "50"
      ? 403
      : 200;
  await drawer.getByRole("button", { name: "Next source records", exact: true }).click();
  const retry = drawer.getByRole("button", { name: "Retry source records", exact: true });
  await expect(retry).toBeVisible();
  fixture.financialReviewStatusForRequest = () => 200;
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(results).toBeFocused();
});

test("finishing a detail request does not reclaim focus after the user moves away", async ({
  page,
}) => {
  const { fixture, drawer, table } = await openRecords(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeFinancialReview = async (entry) => {
    if (entry.endpoint === "financial_review_records" && entry.params.get("offset") === "50") {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await drawer.getByRole("button", { name: "Next source records", exact: true }).click();
    await started.promise;
    const source = drawer.getByLabel("Record source", { exact: true });
    await source.focus();
    release.resolve();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(source).toBeFocused();
  } finally {
    release.resolve();
  }
});

test("an empty detail result announces completion without moving its filter focus", async ({
  page,
}) => {
  const { fixture, drawer } = await openRecords(page);
  fixture.financialReviewRecords = [];
  const source = drawer.getByLabel("Record source", { exact: true });
  await source.focus();
  await source.selectOption("FINANCES");
  const message = "No source records match this selection.";
  await expect(drawer.getByText(message, { exact: true })).toBeVisible();
  await expect(drawer.getByRole("status").filter({ hasText: message })).toBeVisible();
  await expect(source).toBeFocused();
});

for (const focused of ["removed record", "retained filter"]) {
  test(`clamping a removed detail page handles focus on a ${focused}`, async ({ page }) => {
    await page.clock.install();
    const { fixture, drawer, table, results } = await openRecords(page);
    await drawer.getByRole("button", { name: "Next source records", exact: true }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    const source = drawer.getByLabel("Record source", { exact: true });
    const target =
      focused === "removed record"
        ? table.getByRole("button", { name: "View source record", exact: true })
        : source;
    await target.focus();
    fixture.financialReviewRecords = fixture.financialReviewRecords.slice(0, 5);
    fixture.revisions.finances = "1";
    await page.clock.fastForward(60_000);
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(
      drawer.getByRole("navigation", { name: "Pagination for source records", exact: true }),
    ).toContainText("Page 1");
    await expect(focused === "removed record" ? results : source).toBeFocused();
  });
}

test("an aggregate refresh failure preserves the open source controls through recovery", async ({
  page,
}) => {
  await page.clock.install();
  const { fixture, drawer, table } = await openRecords(page);
  const source = drawer.getByLabel("Record source", { exact: true });
  await source.focus();
  fixture.financialReviewStatusForRequest = ({ endpoint }) =>
    endpoint === "current_source_totals" ? 403 : 200;
  fixture.revisions.finances = "1";
  await page.clock.fastForward(60_000);
  const totals = drawer.getByRole("group", { name: "account totals", exact: true });
  await expect(totals.getByRole("alert")).toContainText("Could not load account totals.");
  await expect(source).toBeFocused();
  await expect(table.locator("tbody tr")).toHaveCount(50);

  fixture.financialReviewStatusForRequest = null;
  fixture.revisions.finances = "2";
  await page.clock.fastForward(60_000);
  await expect(totals.getByRole("alert")).toHaveCount(0);
  await expect(totals.getByText("Loading account totals…", { exact: true })).toHaveCount(0);
  await expect(source).toBeFocused();
});

for (const removed of ["month", "currency"]) {
  test(`a successful refresh closes a review whose ${removed} no longer has source records`, async ({
    page,
  }) => {
    await page.clock.install();
    const { fixture, drawer } = await openRecords(page);
    await drawer.getByLabel("Record source", { exact: true }).focus();
    fixture.financialReviewTotals = fixture.financialReviewTotals.filter((row) =>
      removed === "month" ? row.month !== "2026-07-01" : row.currency !== "USD",
    );
    fixture.financialReviewRecords = [];
    fixture.revisions.finances = "1";
    await page.clock.fastForward(60_000);
    await expect(drawer).toBeHidden();
    const july = page.getByRole("button", { name: "Open review for July 2026", exact: true });
    if (removed === "month") {
      await expect(july).toHaveCount(0);
      await expect(page.locator(".financial-review-months")).toBeFocused();
    } else {
      await expect(page.locator(".financial-review-months")).toBeFocused();
      await expect(july).toBeVisible();
      await expect(page.getByText("Monthly amounts · EUR", { exact: true })).toBeVisible();
    }
  });
}
