import {
  feeRow as configurationRow,
  feeDetails,
  feeGroup,
  feePeriods,
  toggleFeePeriods,
} from "./sku-configuration-fixtures.mjs";
import { expect, test } from "@playwright/test";
import { assignmentId, feeRow, skuAssignment } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

const SKU = "GROUP 001 / SAMPLE";
const skuRecord = (page) => configurationRow(page, SKU);
const feeTable = (page) =>
  page.getByRole("table", { name: `Marketplace fees for ${SKU}`, exact: true });
async function feeFixture(page, role = "member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.assignments = Array.from({ length: 26 }, (_, index) => ({
    ...skuAssignment(index + 1),
    sku: index === 0 ? SKU : `GROUP-${String(index + 1).padStart(3, "0")}`,
    company_id: role === "administrator" && index > 0 ? "company-member-b" : "company-member-a",
  }));
  fixture.feeRows = ["5.123456", "4.8", "0", "7.25", "4.8"].map((rate, index) => ({
    ...feeRow(index, assignmentId(1)),
    fee_rate_percent: rate,
    marketplace_name: ["Amazon.com", "Amazon.co.uk", "Amazon.co.jp"][index % 3],
  }));
  return fixture;
}
for (const role of ["member", "administrator"]) {
  test(`${role} expands marketplace periods as rows and preserves whole-SKU details and search`, async ({
    page,
  }, testInfo) => {
    const mobile = role === "member";
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 1000 });
    const fixture = await feeFixture(page, role);
    const pending = deferred();
    fixture.beforeConfiguration = () => pending.promise;
    await signIn(page);
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    const header = page.locator(".workspace-header");
    await expect(header.getByRole("status")).toHaveText("Loading…");
    await expect(page.getByText("Loading assignments and fees…", { exact: true })).toHaveCount(0);
    const headerBounds = await header.boundingBox();
    await expect(skuRecord(page)).toHaveCount(0);
    pending.resolve();
    await expect(skuRecord(page)).toBeVisible();
    await expect(header.getByRole("status").filter({ hasText: "Loading…" })).toHaveCount(0);
    expect(await header.boundingBox()).toEqual(headerBounds);
    await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
      /1[-–]25 of 26 SKUs/,
    );
    const summary = page.getByRole("table", { name: "Current fee configurations", exact: true });
    await expect(feePeriods(page, SKU)).toHaveCount(0);
    if (role === "administrator") await expect(skuRecord(page)).toContainText("Company A");
    else {
      await expect(summary.getByRole("columnheader", { name: "Company", exact: true })).toHaveCount(
        0,
      );
      const status = await openColumn(page, "Status");
      await expect(
        status.getByRole("checkbox", { name: "Needs setup", exact: true }),
      ).toBeVisible();
      await expect(status.getByRole("checkbox", { name: "Saved", exact: true })).toBeVisible();
      await expect(status.getByRole("checkbox", { name: "Draft", exact: true })).toHaveCount(0);
      await expect(
        status.getByRole("checkbox", { name: "Unfinished edit", exact: true }),
      ).toHaveCount(0);
      await status.getByRole("button", { name: "Close options", exact: true }).click();
    }
    await page
      .getByLabel("Search SKUs", { exact: true })
      .fill(role === "administrator" ? "Company A" : SKU);
    await skuRecord(page).scrollIntoViewIfNeeded();
    await toggleFeePeriods(page, SKU);
    await expect(feePeriods(page, SKU)).toHaveCount(5);
    await expect(
      feeGroup(page, SKU).getByRole("cell", { name: "5.123456%", exact: true }),
    ).toBeVisible();
    await expect(feeGroup(page, SKU).getByRole("cell", { name: "0%", exact: true })).toBeVisible();
    const before = await summary
      .locator(":scope > thead th")
      .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
    const pageTop = await page.evaluate(() => globalThis.scrollY);
    await skuRecord(page).press("Enter");
    await expect(feeDetails(page)).toBeVisible();
    expect(await page.evaluate(() => globalThis.scrollY)).toBe(pageTop);
    expect(
      await summary
        .locator(":scope > thead th")
        .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width)),
    ).toEqual(before);
    const table = feeTable(page);
    await expect(table.getByRole("row")).toHaveCount(6);
    await expect(table.getByRole("cell", { name: "5.123456%", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "0%", exact: true })).toBeVisible();
    await expect(table).toContainText("2026-01-02 (exclusive)");
    await expect(table.getByRole("columnheader", { name: "Company", exact: true })).toHaveCount(0);
    await expect(table.getByRole("row").last()).toBeVisible();
    if (mobile) {
      await expect
        .poll(async () => {
          const bounds = await table.locator("..").boundingBox();
          return bounds.x + bounds.width;
        })
        .toBeLessThanOrEqual(390);
    }
    await page.screenshot({
      path: testInfo.outputPath(`sku-fees-${mobile ? "mobile" : "desktop"}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(fixture.configurationRequests.filter(({ completed }) => completed)).toHaveLength(1);
    await page.reload();
    await expect(table.getByRole("row")).toHaveCount(6);
    await expect(feePeriods(page, SKU)).toHaveCount(5);
    await feeDetails(page).getByRole("button", { name: "Close fee details", exact: true }).click();
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue(
      role === "administrator" ? "Company A" : SKU,
    );
    await page.getByLabel("Search SKUs", { exact: true }).fill("absent");
    await expect(page.getByText("No SKUs match these filters.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
    await expect(skuRecord(page)).toHaveAttribute("aria-selected", "false");
  });
}
test("a failed configuration load does not invent empty settings and can be retried", async ({
  page,
}) => {
  const fixture = await feeFixture(page);
  fixture.configurationStatus = 403;
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 403");
  await expect(skuRecord(page)).toHaveCount(0);
  fixture.configurationStatus = 200;
  await page.getByRole("button", { name: "Retry configuration" }).click();
  await skuRecord(page).press("Enter");
  await expect(feeTable(page).getByRole("row")).toHaveCount(6);
});
