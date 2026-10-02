import { expect, test } from "@playwright/test";
import { editor, item, openEditor, period, setup } from "./sku-configuration-fixtures.mjs";

test("dismissing SKU autocomplete keeps the unfinished editor open", async ({ page }) => {
  await setup(page, "operator", [item("S1"), item("SECOND")]);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  const sku = editor(page).getByRole("combobox", { name: "SKU", exact: true });
  await sku.fill("S");
  await expect(page.getByRole("listbox")).toBeVisible();
  await sku.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(editor(page)).toBeVisible();
  await expect(sku).toHaveValue("S");
});

test("removing the only fee period keeps keyboard focus on an editor control", async ({ page }) => {
  const fixture = await setup(page, "operator", [item("S1", { periods: [period()] })]);
  await openEditor(page);
  const remove = editor(page).getByRole("button", { name: "Remove period 1", exact: true });
  await remove.focus();
  await remove.press("Enter");
  await expect(remove).toHaveCount(0);
  await expect(
    editor(page).getByRole("button", { name: "Add fee period", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page).getByLabel("Marketplace 1", { exact: true })).toBeFocused();
  expect(fixture.configurationSaves).toHaveLength(0);
});

for (const interaction of ["keyboard", "pointer"]) {
  test(`removing the final fee period by ${interaction} focuses the preceding period`, async ({
    page,
  }) => {
    const fixture = await setup(page, "operator", [
      item("S1", { periods: [period("1"), period("2")] }),
    ]);
    await openEditor(page);
    const remove = editor(page).getByRole("button", { name: "Remove period 2", exact: true });
    if (interaction === "keyboard") {
      await remove.focus();
      await remove.press("Enter");
    } else await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(editor(page).getByLabel("Marketplace 1", { exact: true })).toBeFocused();
    await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("1");
    expect(fixture.configurationSaves).toHaveLength(0);
  });
}

test("removing a middle fee period keeps the next period keyboard reachable", async ({ page }) => {
  const fixture = await setup(page, "operator", [
    item("S1", { periods: [period("1"), period("2"), period("3")] }),
  ]);
  await openEditor(page);
  const remove = editor(page).getByRole("button", { name: "Remove period 2", exact: true });
  await remove.focus();
  await remove.press("Enter");
  await expect(editor(page).getByLabel("Fee rate 2 (%)", { exact: true })).toHaveValue("3");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(editor(page).getByLabel("Marketplace 2", { exact: true })).toBeFocused();
  expect(fixture.configurationSaves).toHaveLength(0);
});
