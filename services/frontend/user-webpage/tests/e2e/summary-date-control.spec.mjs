import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { summaryBucket, summaryCard, summaryRegion } from "./summary-fixtures.mjs";
import { applyDates, applySummaryDates } from "./table-actions.mjs";

async function expectCornerControl(header) {
  const geometry = await header.evaluate((element) => {
    const heading = element.querySelector(".totals-card-label").getBoundingClientRect();
    const control = element.querySelector("button").getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const padding = Number.parseFloat(
      element.ownerDocument.defaultView.getComputedStyle(element).paddingRight,
    );
    return {
      headingRight: heading.right,
      headingTop: heading.top,
      headingBottom: heading.bottom,
      controlLeft: control.left,
      controlRight: control.right,
      controlTop: control.top,
      controlBottom: control.bottom,
      contentRight: bounds.right - padding,
    };
  });
  expect(geometry.controlLeft).toBeGreaterThanOrEqual(geometry.headingRight + 3);
  expect(Math.abs(geometry.controlRight - geometry.contentRight)).toBeLessThanOrEqual(1);
  expect(geometry.controlTop).toBeLessThan(geometry.headingBottom);
  expect(geometry.headingTop).toBeLessThan(geometry.controlBottom);
}

for (const width of [320, 390, 1440]) {
  test(`date controls stay at the upper right and distinguish their actions at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [summaryBucket("2026-10-05", "12"), summaryBucket("2026-11-06", "34")];
    await signIn(page);
    const totals = summaryRegion(page);
    const dayHeader = summaryCard(page, "Last day").locator(".totals-card-heading");
    const monthHeader = summaryCard(page, "Last month").locator(".totals-card-heading");
    const selectedHeader = summaryCard(page, "Selected dates").locator(".totals-card-heading");
    await expect(dayHeader.getByRole("button")).toHaveText("Nov 5, 2026 · UTC");
    await expect(monthHeader.getByRole("button")).toHaveText("October 2026 · UTC");
    await expect(selectedHeader.getByRole("button")).toHaveText("Choose dates · UTC");
    await expect(totals.locator(".totals-utc-badge")).toHaveCount(0);
    await expect(totals.getByRole("button", { name: "Change dates", exact: true })).toHaveCount(0);
    for (const header of [dayHeader, monthHeader, selectedHeader]) {
      await expect(header.getByRole("button")).toHaveCount(1);
      await expectCornerControl(header);
    }
    for (const header of [dayHeader, monthHeader]) {
      await expect(header.locator(".totals-filter-icon")).toHaveCount(1);
      await expect(header.locator(".totals-calendar-icon")).toHaveCount(0);
      await expect(header.getByRole("button")).not.toHaveAttribute("aria-haspopup", "dialog");
    }
    await expect(selectedHeader.locator(".totals-calendar-icon")).toHaveCount(1);
    await expect(selectedHeader.locator(".totals-filter-icon")).toHaveCount(0);
    await expect(selectedHeader.getByRole("button")).toHaveAttribute("aria-haspopup", "dialog");

    await monthHeader.getByRole("button").click();
    await expect(
      page.getByRole("dialog", { name: "Choose summary dates", exact: true }),
    ).toHaveCount(0);
    await expect(selectedHeader.getByRole("button")).toHaveText("Oct 1–31, 2026 · UTC");
    await expect
      .poll(() => fixture.requests.at(-1).args)
      .toMatchObject({
        p_date_from: "2026-10-01",
        p_date_to: "2026-10-31",
      });
    await dayHeader.getByRole("button").click();
    await expect(selectedHeader.getByRole("button")).toHaveText("Nov 5, 2026 · UTC");
    await expect
      .poll(() => fixture.requests.at(-1).args)
      .toMatchObject({
        p_date_from: "2026-11-05",
        p_date_to: "2026-11-05",
      });

    await applySummaryDates(page, "2026-11-01", "2026-11-06");
    const control = selectedHeader.getByRole("button");
    await expect(control).toHaveText("Nov 1–6, 2026 · UTC");
    await expect(control).toHaveAccessibleName("Change dates: Nov 1–6, 2026 · UTC");
    await expectCornerControl(selectedHeader);
    await expect
      .poll(() => fixture.requests.at(-1).args)
      .toMatchObject({ p_date_from: "2026-11-01", p_date_to: "2026-11-06" });
    await control.focus();
    await page.keyboard.press("Enter");
    const chooser = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByLabel("From date", { exact: true })).toHaveValue("2026-11-01");
    await expect(chooser.getByLabel("To date", { exact: true })).toHaveValue("2026-11-06");
    await page.keyboard.press("Escape");
    await expect(chooser).toBeHidden();
    await expect(control).toBeFocused();

    await applySummaryDates(page, "2026-10-01", "2026-11-06");
    await expect(control).toHaveText("Oct 1 – Nov 6, 2026 · UTC");
    await expectCornerControl(selectedHeader);

    await applyDates(page, "2025-12-31", "2026-11-06");
    await expect(control).toHaveText("Dec 31, 2025 – Nov 6, 2026 · UTC");
    await expect(dayHeader.getByRole("button")).toHaveText("Nov 5, 2026 · UTC");
    await expect(monthHeader.getByRole("button")).toHaveText("October 2026 · UTC");
    const bounds = await control.boundingBox();
    const cardBounds = await summaryCard(page, "Selected dates").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(cardBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width);
    await expectCornerControl(selectedHeader);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await totals.screenshot({
      path: testInfo.outputPath(`corner-summary-dates-${width}.png`),
      animations: "disabled",
    });
    await selectedHeader.screenshot({
      path: testInfo.outputPath(`corner-selected-dates-header-${width}.png`),
      animations: "disabled",
    });

    await applySummaryDates(page, "2026-11-01", "");
    await expect(control).toHaveText("From Nov 1, 2026 · UTC");
    await applySummaryDates(page, "", "2026-11-06");
    await expect(control).toHaveText("Through Nov 6, 2026 · UTC");
    await control.click();
    await chooser.getByRole("button", { name: "Clear dates", exact: true }).click();
    await expect(control).toHaveText("Choose dates · UTC");
    await expect(selectedHeader.getByRole("button")).toHaveCount(1);
  });
}
