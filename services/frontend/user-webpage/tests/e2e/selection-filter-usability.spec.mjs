import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

for (const width of [320, 1280]) {
  test(`selection filters explain immediate changes and finish with focus restored at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await mockSupabase(page);
    await signIn(page);
    const trigger = page.getByRole("button", { name: "Marketplace", exact: true });
    const menu = await openColumn(page, "Marketplace");
    await expect(menu.getByText("Changes apply immediately.", { exact: true })).toBeVisible();
    await menu.getByRole("checkbox", { name: "Amazon.com", exact: true }).check();
    await expect(menu).toBeVisible();
    const done = menu.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeInViewport({ ratio: 1 });
    await done.click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(menu.getByRole("checkbox", { name: "Amazon.com", exact: true })).toBeChecked();
    await menu.getByRole("button", { name: "Clear marketplace", exact: true }).click();
    await done.click();
    await expect(trigger).toBeFocused();
  });
}

test("an inventory selection menu with sorting keeps both ordering and Done reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await mockSupabase(page);
  await mockInventory(
    page,
    Array.from({ length: 30 }, (_, index) =>
      inventoryRow(`FILTER-SKU-${String(index).padStart(3, "0")}`),
    ),
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  const menu = await openColumn(page, "SKU");
  const done = menu.getByRole("button", { name: "Done", exact: true });
  const descending = menu.getByRole("button", { name: "Z to A", exact: true });
  for (const control of [done, descending]) await expect(control).toBeInViewport({ ratio: 1 });
  await descending.click();
  await expect(menu).toBeHidden();
  await openColumn(page, "SKU");
  await expect(descending).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("checkbox", { name: "FILTER-SKU-029", exact: true }).check();
  await done.click();
  await expect(page.getByRole("button", { name: "SKU", exact: true })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Show transactions for FILTER-SKU-029", exact: true }),
  ).toBeVisible();
});
