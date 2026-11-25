import { expect, test } from "@playwright/test";

const HARNESS = "/tests/e2e/harness/detail-drawer.html";

const drawer = (page) => page.getByRole("dialog", { name: "April 2026", exact: true });

function box(locator) {
  return locator.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom, middle: (top + bottom) / 2 };
  });
}

test("the close label is derived from the title unless the drawer names it", async ({ page }) => {
  await page.goto(HARNESS);
  await expect(
    drawer(page).getByRole("button", { name: "Close april 2026", exact: true }),
  ).toBeVisible();
  await expect(drawer(page).locator(".detail-drawer-actions")).toHaveCount(0);

  await page.goto(`${HARNESS}?closeLabel=${encodeURIComponent("Close April 2026")}`);
  const close = drawer(page).getByRole("button", { name: "Close April 2026", exact: true });
  await close.click();
  await expect(drawer(page)).toBeHidden();
});

for (const width of [1440, 390]) {
  test(`header actions sit beside the close button at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(HARNESS);
    const plainHeight = (await box(drawer(page).locator(".mantine-Drawer-header"))).bottom;

    await page.goto(`${HARNESS}?actions`);
    const header = drawer(page).locator(".mantine-Drawer-header");
    const edit = header.getByRole("button", { name: "Edit", exact: true });
    const close = header.getByRole("button", { name: "Close april 2026", exact: true });
    await expect(edit).toBeVisible();
    await expect(drawer(page).locator(".mantine-Drawer-body").getByRole("button")).toHaveCount(0);

    // The header keeps its height; the action is centred on the heading like the close button.
    const [title, action, closeBox, headerBox] = await Promise.all(
      [header.locator(".detail-drawer-heading"), edit, close, header].map(box),
    );
    expect(headerBox.bottom).toBeCloseTo(plainHeight, 0);
    expect(Math.abs(action.middle - closeBox.middle)).toBeLessThanOrEqual(1);
    expect(Math.abs(action.middle - title.middle)).toBeLessThanOrEqual(1);
    expect(action.left).toBeGreaterThan(title.right);
    expect(closeBox.left - action.right).toBeGreaterThanOrEqual(8);
    expect(closeBox.left - action.right).toBeLessThanOrEqual(12);
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );

    // Keyboard order follows the visual order: action, then close.
    await edit.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await edit.click();
    await expect(drawer(page).getByText("Edits: 1", { exact: true })).toBeVisible();
  });
}
