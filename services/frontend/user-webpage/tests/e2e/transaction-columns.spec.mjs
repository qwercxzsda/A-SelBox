import { skuAssignments } from "./api-fixtures.mjs";
import { expect, test } from "@playwright/test";
import { liveRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { summaryBucket, summaryCards } from "./summary-fixtures.mjs";
import { applyDates, openColumn, sortBy } from "./table-actions.mjs";

const tableFor = (page) => page.getByRole("table", { name: "Financial records", exact: true });

function applicabilityRows() {
  return [
    { ...liveRow("ZERO-FEE", 1), fee_base: "0", fee_rate_percent: "0", fee_amount: "0" },
    {
      ...liveRow("MISSING-FEE", 1),
      fee_rate_percent: null,
      fee_amount: null,
      company_amount: null,
      resolution_status: "MISSING_FEE",
    },
    ...Array.from({ length: 24 }, (_, index) => liveRow("APPLIED", index + 1)),
    ...Array.from({ length: 2 }, (_, index) => ({
      ...liveRow("NON-APPLICABLE", index + 1),
      fee_base: null,
      fee_rate_percent: "0",
      fee_amount: "0",
      resolution_status: "NOT_APPLICABLE",
    })),
  ].map((row) => ({
    ...row,
    component_type:
      row.resolution_status === "NOT_APPLICABLE" ? "Order/ItemPrice/Shipping" : "PRODUCT_SALES",
  }));
}

test("fee applicability resets pagination, includes zero and missing rates, and stays out of all summaries", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = applicabilityRows();
  fixture.aggregateRows = [summaryBucket("2026-09-01", "280"), summaryBucket("2026-08-31", "100")];
  fixture.assignments = skuAssignments((fixture.liveRows ?? []).map(({ sku }) => sku));
  await signIn(page);
  await applyDates(page, "2026-09-01", "2026-09-01");
  const summaries = summaryCards(page);
  await expect(summaries.selected.getByRole("button", { name: /View/ })).toBeVisible();
  const totalsBefore = await summaries.summaries.innerText();
  const summaryRequestsBefore = fixture.aggregateRequests.length;
  const latestRequestsBefore = fixture.latestRequests.length;
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();

  const optionsBefore = fixture.optionRequests.length;
  let menu = await openColumn(page, "Fee rate");
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await expect(menu.getByLabel("Search fee rate", { exact: true })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /first/ })).toHaveCount(0);
  await menu.getByRole("checkbox", { name: "Applicable", exact: true }).check();
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  expect(fixture.requests.at(-1).args).toMatchObject({ p_offset: 0, p_fee_applicable: true });
  expect(fixture.countRequests.at(-1).args.p_fee_applicable).toBe(true);
  await expect(rowWithSku(page, "ZERO-FEE-001")).toBeVisible();
  await expect(rowWithSku(page, "MISSING-FEE-001")).toBeVisible();
  await expect(
    rowWithSku(page, "ZERO-FEE-001").locator('[data-column="fee_rate_percent"]'),
  ).toHaveText("0%");
  expect(fixture.optionRequests.length).toBe(optionsBefore);
  await menu.getByRole("checkbox", { name: "Not applicable", exact: true }).check();
  await menu.getByRole("checkbox", { name: "Applicable", exact: true }).uncheck();
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await expect(tableFor(page).getByRole("row")).toHaveCount(3);
  expect(fixture.requests.at(-1).args.p_fee_applicable).toBe(false);
  expect(fixture.countRequests.at(-1).args.p_fee_applicable).toBe(false);
  await expect(
    rowWithSku(page, "NON-APPLICABLE-001").locator('[data-column="fee_rate_percent"]'),
  ).toHaveText("-");
  await expect(
    rowWithSku(page, "NON-APPLICABLE-001").locator('[data-column="fee_amount"]'),
  ).toHaveText("0 USD");
  await menu.getByRole("button", { name: "Close options", exact: true }).click();

  await sortBy(page, "Reported amount", "Highest first");
  await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("amount");
  expect(fixture.requests.at(-1).args.p_fee_applicable).toBe(false);
  await page.getByLabel("Search", { exact: true }).fill("NON-APPLICABLE");
  await expect.poll(() => fixture.countRequests.at(-1).transport).toBe("rpc");
  expect(fixture.requests.at(-1).args.p_fee_applicable).toBe(false);
  expect(fixture.countRequests.at(-1).args.p_fee_applicable).toBe(false);
  await expect(tableFor(page).getByRole("row")).toHaveCount(3);
  expect(await summaries.summaries.innerText()).toBe(totalsBefore);
  expect(fixture.aggregateRequests.length).toBe(summaryRequestsBefore);
  expect(fixture.latestRequests.length).toBe(latestRequestsBefore);
  expect(fixture.latestRequests.every(({ args }) => args.p_fee_applicable === null)).toBe(true);
  expect(fixture.aggregateRequests.every(({ params }) => !params.has("fee_applicable"))).toBe(true);

  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  menu = await openColumn(page, "Fee rate");
  await expect(menu.getByRole("checkbox", { name: "Not applicable", exact: true })).toBeChecked();
  await menu.getByRole("button", { name: "Clear fee rate", exact: true }).click();
  await expect.poll(() => fixture.requests.at(-1).args.p_fee_applicable).toBeNull();
});

for (const width of [1280, 390]) {
  test(`Quantity and bounded Type content remain readable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockSupabase(page);
    const longType = "LongUnbrokenCustomTransactionType".repeat(5);
    fixture.liveRows = [
      { ...liveRow("QUANTITY", 1), quantity: "1234.5", component_type: longType },
      { ...liveRow("QUANTITY", 2), quantity: "0" },
      { ...liveRow("QUANTITY", 3), quantity: null },
    ];
    await signIn(page);
    const table = tableFor(page);
    await expect(table.getByRole("columnheader", { name: "Quantity", exact: true })).toBeVisible();
    for (const [sku, value] of [
      ["QUANTITY-001", "1,234.5"],
      ["QUANTITY-002", "0"],
      ["QUANTITY-003", "—"],
    ]) {
      await expect(rowWithSku(page, sku).locator('[data-column="quantity"]')).toHaveText(value);
    }
    for (const name of ["Quantity", "Company amount", "Service fee"]) {
      const header = table.getByRole("columnheader", { name, exact: true });
      await expect(header.getByRole("button")).toHaveCount(0);
      await expect(header).not.toHaveAttribute("aria-sort");
    }
    const type = rowWithSku(page, "QUANTITY-001").locator('[data-column="component_type"] > span');
    expect(await type.getAttribute("title")).toContain(longType);
    const metrics = await type.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(globalThis.getComputedStyle(element).lineHeight),
      overflow: element.scrollWidth - element.clientWidth,
    }));
    expect(metrics.width).toBeLessThanOrEqual(320);
    expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight + 1);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await type.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`transaction-columns-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    const menu = await openColumn(page, "Fee rate");
    await expect(menu.getByRole("checkbox", { name: "Applicable", exact: true })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`fee-filter-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
