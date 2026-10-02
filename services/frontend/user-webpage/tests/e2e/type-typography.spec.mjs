import { expect, test } from "@playwright/test";
import { liveRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

const TYPES = [
  {
    code: "Order/ItemWithheldTax/MarketplaceFacilitatorVAT-Principal",
    label: "Order · Item withheld tax · Marketplace facilitator VAT principal",
    leaf: "Marketplace facilitator VAT principal",
  },
  {
    code: "Order/ItemWithheldTax/MarketplaceFacilitatorVAT-Shipping",
    label: "Order · Item withheld tax · Marketplace facilitator VAT shipping",
    leaf: "Marketplace facilitator VAT shipping",
  },
  {
    code: "FBAFees/FBA Amazon-Partnered Carrier Shipment Fee/Base fee",
    label: "FBA fees · FBA Amazon partnered carrier shipment fee · Base fee",
    leaf: "Base fee",
  },
  {
    code: "LONG_UNRECOGNIZED_CUSTOM_TRANSACTION_TYPE_".repeat(5),
    label: `Long ${"unrecognized custom transaction type long ".repeat(4)}unrecognized custom transaction type`,
    leaf: null,
  },
];

for (const width of [1440, 390]) {
  test(`transaction type hierarchy stays on one line within the existing column at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.liveRows = TYPES.map(({ code }, index) => ({
      ...liveRow("TYPE", index + 1),
      component_type: code,
    }));
    await signIn(page);
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(TYPES.length);
    for (const [index, type] of TYPES.entries()) {
      const cell = rowWithSku(page, `TYPE-${String(index + 1).padStart(3, "0")}`).locator(
        '[data-column="component_type"]',
      );
      const value = cell.locator(".transaction-type");
      await expect(value).toHaveText(type.label);
      expect(await value.getAttribute("title")).toBe(`${type.label}\n${type.code}`);
      await expect(cell).toHaveCSS("min-width", "320px");
      await expect(cell).toHaveCSS("max-width", "320px");
      const metrics = await value.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      });
      expect(metrics.width).toBeLessThanOrEqual(320);
      expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight + 1);
      const leaf = value.locator(".transaction-type-leaf");
      await expect(leaf).toHaveCSS("white-space", "nowrap");
      await expect(leaf).toHaveCSS("text-overflow", "ellipsis");
      if (type.leaf) {
        await expect(value).toHaveAttribute("data-hierarchical", "true");
        await expect(leaf).toHaveText(type.leaf);
        const typography = await value.evaluate((element) => {
          const prefix = element.querySelector(".transaction-type-prefix");
          const leaf = element.querySelector(".transaction-type-leaf");
          const prefixStyle = globalThis.getComputedStyle(prefix);
          const leafStyle = globalThis.getComputedStyle(leaf);
          return {
            prefixSize: Number.parseFloat(prefixStyle.fontSize),
            leafSize: Number.parseFloat(leafStyle.fontSize),
            prefixColor: prefixStyle.color,
            leafColor: leafStyle.color,
            leafOverflow: leaf.scrollWidth - leaf.clientWidth,
          };
        });
        expect(typography.prefixSize).toBeLessThan(typography.leafSize);
        expect(typography.prefixColor).not.toBe(typography.leafColor);
        expect(typography.leafOverflow).toBeLessThanOrEqual(1);
      } else {
        await expect(value.locator(".transaction-type-prefix")).toHaveCount(0);
        expect(
          await leaf.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeGreaterThan(0);
      }
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
    const first = rowWithSku(page, "TYPE-001").locator(".transaction-type");
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`transaction-type-${width}.png`),
      animations: "disabled",
    });
    await first.click();
    const details = page.getByRole("dialog", { name: "Selected row details", exact: true });
    const fullType = details
      .locator(".detail-field")
      .filter({ has: page.getByText("Type", { exact: true }) })
      .locator(".field-value");
    await expect(fullType).toHaveText(TYPES[0].label);
    const detailMetrics = await fullType.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(detailMetrics.height).toBeGreaterThan(detailMetrics.lineHeight);
    expect(detailMetrics.overflow).toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
  });
}
