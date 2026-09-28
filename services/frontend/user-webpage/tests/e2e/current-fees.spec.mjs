import { expect, test } from "@playwright/test";
import { assignmentId, feeRow, skuAssignment } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";

const SKU = "GROUP 001 / SAMPLE";
const skuButton = (page) =>
  page.getByRole("button", { name: `Show marketplace fees for ${SKU}`, exact: true });
const feeTable = (page) =>
  page.getByRole("table", { name: `Marketplace fees for ${SKU}`, exact: true });
async function feeFixture(page, role = "company_member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.assignments = Array.from({ length: 26 }, (_, index) => ({
    ...skuAssignment(index + 1),
    sku: index === 0 ? SKU : `GROUP-${String(index + 1).padStart(3, "0")}`,
    company_id: role === "operator" && index > 0 ? "company-member-b" : "company-member-a",
  }));
  fixture.feeRows = ["5.123456", "4.8", "0", "7.25", "4.8"].map((rate, index) => ({
    ...feeRow(index, assignmentId(1)),
    fee_rate_percent: rate,
    marketplace_name: ["Amazon.com", "Amazon.co.uk", "Amazon.co.jp"][index % 3],
  }));
  return fixture;
}
for (const role of ["company_member", "operator"]) {
  test(`${role} views one complete SKU configuration with persistent search and expanded fees`, async ({
    page,
  }, testInfo) => {
    const mobile = role === "company_member";
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 1000 });
    const fixture = await feeFixture(page, role);
    const pending = deferred();
    fixture.beforeConfiguration = () => pending.promise;
    await signIn(page);
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(page.getByText("Loading assignments and fees…", { exact: true })).toBeVisible();
    await expect(skuButton(page)).toHaveCount(0);
    pending.resolve();
    await expect(skuButton(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
      /1[-–]25 of 26 SKUs/,
    );
    await expect(skuButton(page)).toContainText("Company A");
    await page
      .getByLabel("Search SKUs", { exact: true })
      .fill(role === "operator" ? "Company A" : SKU);
    await skuButton(page).click();
    const table = feeTable(page);
    await expect(table.getByRole("row")).toHaveCount(6);
    await expect(table.getByRole("cell", { name: "5.123456%", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "0%", exact: true })).toBeVisible();
    await expect(table).toContainText("Before 2026-01-02");
    await expect(table.getByRole("columnheader", { name: "Company", exact: true })).toHaveCount(0);
    await expect(table.getByRole("row").last()).toBeVisible();
    if (mobile) {
      const bounds = await table.boundingBox();
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({
      path: testInfo.outputPath(`sku-fees-${mobile ? "mobile" : "desktop"}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(fixture.configurationRequests.filter(({ completed }) => completed)).toHaveLength(1);
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(skuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(table.getByRole("row")).toHaveCount(6);
    expect(fixture.configurationRequests.filter(({ completed }) => completed)).toHaveLength(1);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await page.getByLabel("Search SKUs", { exact: true }).fill("absent");
    await expect(page.getByText("No SKUs match your search.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
    await expect(skuButton(page)).toHaveAttribute("aria-expanded", "false");
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
  await expect(skuButton(page)).toHaveCount(0);
  fixture.configurationStatus = 200;
  await page.getByRole("button", { name: "Retry configuration" }).click();
  await skuButton(page).click();
  await expect(feeTable(page).getByRole("row")).toHaveCount(6);
});
