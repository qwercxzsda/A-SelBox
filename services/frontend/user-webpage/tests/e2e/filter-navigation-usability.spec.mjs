import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyDates, applyReportMonth, openColumn } from "./table-actions.mjs";

test("Back and Forward close stale date drafts and reopen the restored bounds", async ({
  page,
}) => {
  await mockSupabase(page);
  await signIn(page);
  await applyDates(page, "2026-06-01", "2026-06-30");
  await applyDates(page, "2026-07-01", "2026-07-31");
  const menu = await openColumn(page, "Date");
  await menu.getByLabel("From date", { exact: true }).fill("2026-08-01");
  await page.goBack();
  await expect(menu).toBeHidden();
  await openColumn(page, "Date");
  await expect(menu.getByLabel("From date", { exact: true })).toHaveValue("2026-06-01");
  await page.goForward();
  await expect(menu).toBeHidden();
  await openColumn(page, "Date");
  await expect(menu.getByLabel("From date", { exact: true })).toHaveValue("2026-07-01");
});

test("Back and Forward restore payout month without retaining an unsubmitted month", async ({
  page,
}) => {
  await mockSupabase(page);
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await applyReportMonth(page, "2026-06");
  await applyReportMonth(page, "2026-07");
  const menu = await openColumn(page, "Month");
  await menu.getByLabel("Report month", { exact: true }).fill("2026-08");
  await page.goBack();
  await expect(menu).toBeHidden();
  await openColumn(page, "Month");
  await expect(menu.getByLabel("Report month", { exact: true })).toHaveValue("2026-06");
  await page.goForward();
  await expect(menu).toBeHidden();
  await openColumn(page, "Month");
  await expect(menu.getByLabel("Report month", { exact: true })).toHaveValue("2026-07");
});

test("200 percent equivalent viewport keeps long selection labels and menu actions usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 640, height: 360 });
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.skuOptions = Array.from(
    { length: 40 },
    (_, index) =>
      `QA-LONG-SKU-${String(index).padStart(3, "0")}-Sensitive Skin Moisturizing Sunscreen Refill Pack 250ml Variant with multilingual packaging`,
  );
  await signIn(page);
  const menu = await openColumn(page, "SKU");
  const last = menu.getByRole("checkbox").last();
  await last.scrollIntoViewIfNeeded();
  await last.check();
  await expect(last).toBeChecked();
  await expect(menu.getByRole("button", { name: "Done", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(menu.getByRole("button", { name: "Close options", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: testInfo.outputPath("long-label-menu-200-percent-layout.png") });
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  const dates = await openColumn(page, "Date");
  await dates.getByLabel("From date", { exact: true }).fill("2026-07-31");
  await dates.getByLabel("To date", { exact: true }).fill("2026-07-01");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(dates.getByRole("alert")).toBeVisible();
  await dates.getByLabel("From date", { exact: true }).fill("2026-07-01");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(dates).toBeHidden();
});
