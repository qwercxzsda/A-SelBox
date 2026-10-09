import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

const SETTLEMENT_TYPES = [
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

const DATA_KIOSK_TYPES = [
  {
    code: "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
    label: "FBA inbound placement service fee",
    leaf: null,
  },
  {
    code: "MONTHLY_INVENTORY_STORAGE_FEE",
    label: "Monthly inventory storage fee",
    leaf: null,
  },
  {
    code: "FBA_INVENTORY_REIMBURSEMENT",
    label: "FBA inventory reimbursement",
    leaf: null,
  },
  SETTLEMENT_TYPES.at(-1),
];

const DATASETS = [
  {
    key: "live",
    label: "Transactions",
    rows: "liveRows",
    makeRow: (index) => liveRow("TYPE", index),
    types: SETTLEMENT_TYPES,
  },
  {
    key: "settlement",
    label: "Settlements",
    rows: "settlementRows",
    makeRow: settlementRow,
    types: SETTLEMENT_TYPES,
  },
  {
    key: "data_kiosk",
    label: "Data Kiosk",
    rows: "kioskRows",
    makeRow: (index) => kioskRow(index, "10"),
    types: DATA_KIOSK_TYPES,
  },
];

for (const dataset of DATASETS) {
  for (const width of [1440, 1920, 390]) {
    test(`${dataset.label} type text stays on one line within the existing column at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await mockSupabase(page);
      fixture.roles["member-a"] = "administrator";
      fixture[dataset.rows] = dataset.types.map(({ code }, index) => ({
        ...dataset.makeRow(index + 1),
        sku: `TYPE-${String(index + 1).padStart(3, "0")}`,
        component_type: code,
      }));
      await signIn(page);
      await page.getByRole("tab", { name: dataset.label, exact: true }).click();
      const table = page.getByRole("table", { name: "Financial records", exact: true });
      await expect(table.locator("tbody tr")).toHaveCount(dataset.types.length);
      for (const [index, type] of dataset.types.entries()) {
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
          const overflow = await leaf.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          );
          if (type.code.startsWith("LONG_UNRECOGNIZED")) expect(overflow).toBeGreaterThan(0);
          else expect(overflow).toBeLessThanOrEqual(1);
        }
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
          ),
        )
        .toBe(true);
      const detailIndex = dataset.types[0].leaf ? 0 : dataset.types.length - 1;
      const detailType = dataset.types[detailIndex];
      const first = rowWithSku(page, `TYPE-${String(detailIndex + 1).padStart(3, "0")}`).locator(
        ".transaction-type",
      );
      await first.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`type-${dataset.key}-${width}.png`),
        animations: "disabled",
      });
      await first.click();
      const details = page.getByRole("dialog", { name: "Selected row details", exact: true });
      const fullType = details
        .locator(".detail-field")
        .filter({ has: page.getByText("Type", { exact: true }) })
        .locator(".field-value");
      await expect(fullType).toHaveText(detailType.label);
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
      await details.getByRole("button", { name: "Close row details", exact: true }).click();
      await page.getByRole("button", { name: "Type", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "Type options", exact: true });
      const filteredType = dataset.types[0];
      await menu
        .getByLabel("Search type", { exact: true })
        .fill(filteredType.leaf ?? filteredType.label);
      await menu.getByRole("checkbox", { name: filteredType.label, exact: true }).check();
      await menu.getByRole("button", { name: "Done", exact: true }).click();
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(rowWithSku(page, "TYPE-001")).toBeVisible();
      await expect
        .poll(
          () =>
            fixture.requests.filter(({ dataset: key }) => key === dataset.key).at(-1)?.args
              ?.p_types,
        )
        .toEqual([filteredType.code]);
    });
  }
}
