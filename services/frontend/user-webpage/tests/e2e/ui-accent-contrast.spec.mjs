import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { item, COMPANY } from "./sku-configuration-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { summaryBucket } from "./summary-fixtures.mjs";

async function contrast(locator) {
  return locator.evaluate((element) => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const parse = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha / 255];
    };
    const luminance = (rgb) => {
      const channels = rgb
        .slice(0, 3)
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    let background = [255, 255, 255];
    for (let parent = element; parent; parent = parent.parentElement) {
      const color = parse(globalThis.getComputedStyle(parent).backgroundColor);
      if (color.length === 3 || color[3] === 1) {
        background = color;
        break;
      }
    }
    const foreground = luminance(parse(globalThis.getComputedStyle(element).color));
    const behind = luminance(background);
    return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
  });
}

test("primary sign-in text remains readable before and during hover", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/");
  const signInButton = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signInButton).toBeVisible();
  expect(await contrast(signInButton)).toBeGreaterThanOrEqual(4.5);
  const background = await signInButton.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor,
  );
  await signInButton.hover();
  await expect
    .poll(() =>
      signInButton.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    )
    .not.toBe(background);
  expect(await contrast(signInButton)).toBeGreaterThanOrEqual(4.5);
});

test("fee setup warning counts remain readable on their tinted background", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-a"] = COMPANY;
  fixture.skuConfigurationItems = [item("S1", { periods: [] })];
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  const title = page
    .getByRole("alert")
    .filter({ hasText: "1 SKU needs setup" })
    .getByText("1 SKU needs setup", { exact: true });
  await expect(title).toBeVisible();
  expect(await contrast(title)).toBeGreaterThanOrEqual(4.5);
});

for (const width of [1440, 390]) {
  test(`small shared links and active controls remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.companyIds["member-a"] = COMPANY;
    fixture.skuConfigurationItems = [item("S1")];
    fixture.aggregateRows = [summaryBucket("2026-06-30", "120"), summaryBucket("2026-07-01", "0")];
    await mockInventory(page, [inventoryRow("S1", { company_id: COMPANY })]);
    await signIn(page);
    const totals = page.getByRole("region", { name: "Current totals", exact: true });
    const day = totals.getByRole("table", { name: "Last day marketplace totals", exact: true });
    const period = totals
      .getByRole("article", { name: "Last day totals", exact: true })
      .getByRole("button", {
        name: "Filter transactions to Jun 30, 2026 · UTC",
        exact: true,
      });
    await expect(period).toBeVisible();
    expect(await contrast(period)).toBeGreaterThanOrEqual(4.5);
    await period.hover();
    expect(await contrast(period)).toBeGreaterThanOrEqual(4.5);
    const selectedControl = totals.getByRole("button", { name: "Choose dates · UTC", exact: true });
    expect(await contrast(selectedControl)).toBeGreaterThanOrEqual(4.5);
    await selectedControl.hover();
    expect(await contrast(selectedControl)).toBeGreaterThanOrEqual(4.5);
    const breakdownLinks = day.getByRole("button", { name: /by type: / });
    await expect(breakdownLinks).toHaveCount(1);
    for (const link of await breakdownLinks.all()) {
      await expect(link).toBeVisible();
      expect(await contrast(link)).toBeGreaterThanOrEqual(4.5);
      await link.hover();
      expect(await contrast(link)).toBeGreaterThanOrEqual(4.5);
    }
    for (const name of ["Current fees", "Inventory"]) {
      const tab = page.getByRole("tab", { name, exact: true });
      await tab.click();
      expect(await contrast(tab)).toBeGreaterThanOrEqual(4.5);
      const sku = page.getByRole("button", { name: "Show transactions for S1", exact: true });
      await expect(sku).toBeVisible();
      expect(await contrast(sku)).toBeGreaterThanOrEqual(4.5);
      await sku.hover();
      expect(await contrast(sku)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
