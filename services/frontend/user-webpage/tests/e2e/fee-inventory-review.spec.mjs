import { expect, test } from "@playwright/test";
import { setup, item, openReview, editor, review } from "./sku-configuration-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";

test("fee review remains usable with long SKU identifiers", async ({ page }, testInfo) => {
  const sku = "REPLACEMENT_PART_EXTRA_LARGE_BLACK_WITH_ACCESSORIES_AND_INSTRUCTIONS_2026";
  const incompleteSku = `${sku}_NEEDS_SETUP`;
  await setup(page, "operator", [item("S1"), item(sku), item(incompleteSku, { company_id: null })]);
  await page.getByRole("button", { name: `Edit ${sku}`, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(editor(page).getByRole("button", { name: "Close SKU editor" })).toBeInViewport();
  expect(await editor(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  for (const width of [1920, 1440, 834, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await review(page)
        .locator(".sku-configuration-drawer-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(review(page).getByRole("button", { name: `Edit ${sku}`, exact: true })).toHaveText(
      "Edit",
    );
    await page.screenshot({
      path: testInfo.outputPath(`fee-review-${width}.png`),
      animations: "disabled",
    });
    await expect(
      review(page).getByRole("button", { name: "Save all changes", exact: true }),
    ).toBeInViewport();
  }
  await review(page).getByRole("button", { name: "Show setup issues (1)", exact: true }).click();
  const complete = review(page).getByRole("button", {
    name: `Complete ${incompleteSku}`,
    exact: true,
  });
  await expect(complete).toBeInViewport();
  const bounds = await complete.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await complete.click();
  await expect(editor(page)).toHaveAccessibleName(`Edit ${incompleteSku}`);
});

for (const role of ["operator", "company_member"]) {
  test(`${role} can page inventory from the desktop toolbar and clear search without losing marketplace`, async ({
    page,
  }, testInfo) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    await mockInventory(page, [
      ...Array.from({ length: 26 }, (_, index) =>
        inventoryRow(`SKU-${String(index).padStart(2, "0")}`),
      ),
      inventoryRow("OTHER", { marketplace_name: "Amazon.ca" }),
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    const top = page.getByRole("navigation", { name: "Inventory pagination, top", exact: true });
    const bottom = page.getByRole("navigation", { name: "Pagination", exact: true });
    await expect(top.getByText("27 inventory items", { exact: true })).toBeVisible();
    await expect(top.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await top.getByRole("button", { name: "Next", exact: true }).click();
    await expect(top.getByLabel("Page number")).toHaveValue("2");
    await expect(bottom.getByLabel("Page number")).toHaveValue("2");
    await expect(page.locator(".inventory-sku")).toHaveText(["SKU-24", "SKU-25"]);
    await bottom.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(top.getByLabel("Page number")).toHaveValue("1");
    await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.com");
    await page.getByLabel("Search", { exact: true }).fill("SKU-25");
    await expect(page.locator(".inventory-sku")).toHaveText(["SKU-25"]);
    await page.getByRole("button", { name: "Clear search", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Marketplace", { exact: true })).toHaveValue("Amazon.com");
    await expect(top.getByText("26 inventory items", { exact: true })).toBeVisible();
    await page.reload();
    await expect(top.getByText("26 inventory items", { exact: true })).toBeVisible();
    for (const width of [1920, 1440, 834, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(top.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`inventory-${role}-${width}.png`),
        animations: "disabled",
      });
    }
  });
}
