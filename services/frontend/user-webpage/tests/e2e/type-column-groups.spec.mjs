import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";

const TYPES = [
  ["PRODUCT_SALES", "Product sales", "Sales & refunds", "FINANCES"],
  ["REFERRAL_FEES", "Referral fees", "Selling fees", "FINANCES"],
  ["FBA_STORAGE_FEE", "FBA storage fee", "Storage & inventory", "DATA_KIOSK"],
  ["TAX_WITHHELD", "Tax withheld", "Taxes", "FINANCES"],
  ["DEBT_RECOVERY", "Debt recovery", "Other fees & adjustments", "SELBOX"],
  ["UNRECOGNIZED_ENTRY", "Unrecognized entry", "Other fees & adjustments", "FINANCES"],
];

async function typography(value) {
  return value.evaluate((element) => {
    const primary = element.querySelector(".transaction-type-label");
    const secondary = element.querySelector(".transaction-type-group");
    const main = globalThis.getComputedStyle(primary);
    const group = globalThis.getComputedStyle(secondary);
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const parse = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    let background = [255, 255, 255, 255];
    for (let parent = secondary; parent; parent = parent.parentElement) {
      const color = parse(globalThis.getComputedStyle(parent).backgroundColor);
      if (color[3] === 255) {
        background = color;
        break;
      }
    }
    const luminance = (color) => {
      const [r, g, b] = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    const foreground = luminance(parse(group.color));
    const behind = luminance(background);
    return {
      primarySize: Number.parseFloat(main.fontSize),
      secondarySize: Number.parseFloat(group.fontSize),
      primaryWeight: Number(main.fontWeight),
      secondaryWeight: Number(group.fontWeight),
      primaryColor: main.color,
      secondaryColor: group.color,
      secondaryOpacity: group.opacity,
      primaryBottom: primary.getBoundingClientRect().bottom,
      secondaryTop: secondary.getBoundingClientRect().top,
      contrast: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05),
    };
  });
}

for (const width of [1440, 390]) {
  test(`type columns show readable filter groups without changing exact types at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.liveRows = TYPES.map(([type, , , category], index) => ({
      ...liveRow("GROUP", index + 1),
      category,
      source: category === "DATA_KIOSK" ? "DATA_KIOSK" : "FINANCES",
      component_type: type,
      activity_date: category === "DATA_KIOSK" ? "2026-10-30" : "2026-10-31",
      activity_at:
        category === "DATA_KIOSK" ? "2026-10-31T06:59:59.999999Z" : "2026-10-31T12:00:00.000000Z",
    }));
    fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
    fixture.aggregateRows = [
      summaryBucket("2026-11-01", "0"),
      summaryBucket("2026-10-31", "100", { rowCount: 5 }),
    ];
    fixture.breakdownRows = TYPES.filter(([, , , category]) => category !== "SELBOX").map(
      ([type]) => typeBucket(type, "20"),
    );
    await signIn(page);
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(TYPES.length);
    for (const [index, [type, label, group]] of TYPES.entries()) {
      const value = rowWithSku(page, `GROUP-${String(index + 1).padStart(3, "0")}`).locator(
        '[data-column="component_type"] .transaction-type',
      );
      await expect(value.locator(".transaction-type-label")).toHaveText(label);
      await expect(value.locator(".transaction-type-group")).toHaveText(group);
      expect(await value.getAttribute("title")).toBe(`${label}\n${group}\n${type}`);
      const style = await typography(value);
      expect(style.primarySize).toBeGreaterThan(style.secondarySize);
      expect(style.primaryWeight).toBeGreaterThan(style.secondaryWeight);
      expect(style.primaryColor).not.toBe(style.secondaryColor);
      expect(style.secondaryOpacity).toBe("1");
      expect(style.secondaryTop).toBeGreaterThanOrEqual(style.primaryBottom - 1);
      expect(style.contrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await table.locator('[data-column="component_type"]').last().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`type-groups-${width}.png`),
      animations: "disabled",
    });

    const menu = await openColumn(page, "Type");
    for (const group of new Set(TYPES.map((entry) => entry[2])))
      await expect(menu.getByRole("checkbox", { name: group, exact: true })).toBeVisible();
    await menu.getByRole("checkbox", { name: "Sales & refunds", exact: true }).check();
    await menu.getByRole("button", { name: "Done", exact: true }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(rowWithSku(page, "GROUP-001")).toBeVisible();
    expect(fixture.requests.at(-1).args.p_types).toContain("PRODUCT_SALES");
    expect(fixture.requests.at(-1).args.p_types).not.toContain("Sales & refunds");

    await page
      .getByRole("button", { name: /^View Last month for Amazon.com in USD by type:/ })
      .click();
    const drawer = page.getByRole("dialog", { name: "Amounts by type", exact: true });
    const records = drawer.getByRole("table", { name: "Amount records", exact: true });
    await expect(records.locator("tbody tr")).toHaveCount(5);
    await expect(records.locator(".transaction-type-group")).toHaveCount(5);
    await expect(records.locator(".transaction-type-group")).toContainText([
      "Other fees & adjustments",
      "Taxes",
      "Selling fees",
      "Sales & refunds",
      "Storage & inventory",
    ]);
    await drawer.getByRole("button", { name: "Close breakdown", exact: true }).click();
  });
}
