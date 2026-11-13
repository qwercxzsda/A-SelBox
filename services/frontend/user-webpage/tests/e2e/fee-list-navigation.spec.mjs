import { expect, test } from "@playwright/test";
import { item, setup, version, feeRow, feeDetails } from "./sku-configuration-fixtures.mjs";

for (const [role, width] of [
  ["member", 1280],
  ["administrator", 390],
]) {
  test(`${role} can page a long fee list from its end at ${width}px without shifting the list when opening details`, async ({
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
    const first = feeRow(page, "S1");
    await first.press("Enter");
    await feeDetails(page).getByRole("button", { name: "Close fee details", exact: true }).click();
    await feeRow(page, "Z-SKU-025").scrollIntoViewIfNeeded();
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
    await expect(feeRow(page, "Z-SKU-026")).toBeInViewport();
    await expect(page.getByRole("group", { name: "Fee list controls", exact: true })).toBeFocused();
    await bottom.getByRole("button", { name: "Previous SKUs", exact: true }).click();
    await expect(first).toBeInViewport();
    await expect(first).toHaveAttribute("aria-selected", "false");
    await expect(feeDetails(page)).toBeHidden();
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
    expect(fixture.configurationSaves).toHaveLength(0);
  });
}
