import { expect, test } from "@playwright/test";
import { item, setup, version } from "./sku-configuration-fixtures.mjs";

for (const [role, width] of [
  ["member", 1280],
  ["administrator", 390],
]) {
  test(`${role} can page a long fee list from its end at ${width}px without losing expansions`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const fixture = await setup(
      page,
      role,
      Array.from({ length: 30 }, (_, index) =>
        item(index === 0 ? "S1" : `Z-SKU-${String(index + 1).padStart(3, "0")}`, {
          sku_id: version(index + 1),
          terms_version_id: version(index + 101),
        }),
      ),
    );
    const first = page.getByRole("button", { name: "Show marketplace fees for S1: " });
    await first.click();
    await page
      .getByRole("button", { name: "Show marketplace fees for Z-SKU-025: " })
      .scrollIntoViewIfNeeded();
    const bottom = page.getByRole("navigation", {
      name: "SKU list navigation at bottom",
      exact: true,
    });
    await expect(bottom).toBeVisible();
    await bottom.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`fee-bottom-navigation-${width}.png`),
      animations: "disabled",
    });
    await bottom.getByRole("button", { name: "Next SKUs", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Show marketplace fees for Z-SKU-026: " }),
    ).toBeInViewport();
    await expect(page.getByRole("group", { name: "Fee list controls", exact: true })).toBeFocused();
    await bottom.getByRole("button", { name: "Previous SKUs", exact: true }).click();
    await expect(first).toBeInViewport();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("table", { name: "Marketplace fees for S1", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
    expect(fixture.configurationSaves).toHaveLength(0);
  });
}
