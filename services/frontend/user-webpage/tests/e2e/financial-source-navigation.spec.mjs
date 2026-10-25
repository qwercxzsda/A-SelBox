import { expect, test } from "./accessibility-fixture.mjs";
import { openSourceLookup, sourceDetail } from "./financial-source-fixtures.mjs";

for (const width of [390, 1280]) {
  test(`cached source pages return to their first record at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const { table } = await openSourceLookup(page, {
      count: 55,
      configure: (state) => {
        state.rows.forEach((row, index) => {
          row.amount = String(index + 1);
        });
      },
    });
    await page
      .getByRole("button", { name: /^Next matches/ })
      .last()
      .click();
    await expect(table.locator("tbody tr").first()).toContainText("26.00");
    await page
      .getByRole("button", { name: /^Previous matches/ })
      .last()
      .click();
    await expect(table.locator("tbody tr").first()).toContainText("1.00");
    await expect(table.locator("tbody tr").first()).toBeInViewport();
    const results = page.getByRole("region", { name: "Amazon transaction results", exact: true });
    await expect(results).toBeFocused();
  });
}

test("long exact transaction identifiers remain contained on a phone", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const nativeId = "N".repeat(512);
  const { lookup } = await openSourceLookup(page, { nativeId });
  await expect(
    lookup.getByRole("button", { name: "Close transaction lookup", exact: true }),
  ).toBeInViewport();
  await expect(
    lookup.getByRole("button", { name: "Find transaction", exact: true }),
  ).toBeInViewport();
  expect(await lookup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const summary = page.getByText(`Showing ${nativeId}.`, { exact: false });
  await expect(summary).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("source-lookup-long-id-phone.png"),
    animations: "disabled",
  });
  await expectAccessible("transaction-lookup-phone");
});

test("a long SKU stays inside its source detail panel", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const sku = "EXACT-SKU-" + "X".repeat(230);
  const { opener } = await openSourceLookup(page, {
    configure: (state) => {
      state.rows[0].sku = sku;
    },
  });
  await opener.click();
  const drawer = sourceDetail(page);
  await expect(drawer.getByRole("heading", { name: sku, exact: true })).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("source-detail-long-sku-phone.png"),
    animations: "disabled",
  });
});
