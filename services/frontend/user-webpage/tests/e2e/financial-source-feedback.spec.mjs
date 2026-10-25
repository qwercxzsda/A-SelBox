import { expect, test } from "@playwright/test";
import { deferred, waitForRequestSettled } from "./fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import {
  openSourceLookup as openLookup,
  recordId,
  sourceDetail as detail,
  sourceRoutes,
  versionId,
} from "./financial-source-fixtures.mjs";

for (const width of [390, 1280]) {
  test(`a pending source record opens a visible cancellable panel at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const { state, opener, lookup, trigger } = await openLookup(page);
    const response = deferred();
    state.wait = response.promise;
    const settled = waitForRequestSettled(page, (request) =>
      request.url().endsWith("/financial_source_record"),
    );
    try {
      await opener.click();
      await expect(detail(page)).toBeVisible();
      await expect(
        detail(page).getByText("Loading source record…", { exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`source-loading-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(detail(page)).toBeHidden();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(lookup).toBeHidden();
      await expect(trigger).toBeFocused();
      response.resolve();
      await settled;
      await expect(detail(page)).toBeHidden();
      await expect(lookup).toBeHidden();
    } finally {
      response.resolve();
    }
  });
}

test("source-record errors and unavailable versions stay visible with recovery and focus return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { state, opener } = await openLookup(page);
  state.status = 403;
  await opener.click();
  await expect(detail(page).getByRole("alert")).toBeInViewport();
  await expect(detail(page).getByRole("alert")).toContainText("Could not load source record.");
  state.status = 200;
  state.missing = true;
  await detail(page).getByRole("button", { name: "Retry source record", exact: true }).click();
  await expect(
    detail(page).getByText(/This exact source row\/version is no longer available/),
  ).toBeInViewport();
  await detail(page).getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(opener).toBeFocused();
  expect(
    state.requests.filter((args) => args.p_row_id).every((args) => args.p_version_id === versionId),
  ).toBe(true);
});

test("a source error completed before the drawer mounts remains visible", async ({ page }) => {
  await page.clock.install();
  const { state, opener } = await openLookup(page);
  state.status = 403;
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  const settled = waitForRequestSettled(page, (request) =>
    request.url().endsWith("/financial_source_record"),
  );
  try {
    // Keep the drawer's opening frame paused while the request finishes.
    await opener.press("Enter");
    await settled;
    // A browser task lets the response's promise callbacks finish before frames resume.
    await page.evaluate(() => Promise.resolve());
  } finally {
    await page.clock.resume();
  }
  await expect(detail(page).getByRole("alert")).toContainText("Could not load source record.");
  await expect(
    detail(page).getByRole("button", { name: "Retry source record", exact: true }),
  ).toBeInViewport();
});

test("a nested source failure opens above monthly review and returns to its exact record", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFinancialReview(page, (fixture) => {
    fixture.financialReviewRecords.forEach((row, index) => {
      row.source_row_id = recordId(index);
      row.source_version_id = versionId;
    });
  });
  const state = await sourceRoutes(page);
  state.status = 403;
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await monthly.getByRole("button", { name: "Source records", exact: true }).click();
  const table = monthly.getByRole("table", { name: "Source records", exact: true });
  const opener = table.getByRole("button", { name: "View source record", exact: true }).first();
  await opener.click();
  await expect(detail(page).getByRole("alert")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(detail(page)).toBeHidden();
  await expect(monthly).toBeVisible();
  await expect(opener).toBeFocused();
});
