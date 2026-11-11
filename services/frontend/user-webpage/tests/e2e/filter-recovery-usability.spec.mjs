import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { skuAssignment } from "./api-fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

for (const [tab, label, recovery] of [
  ["Transactions", "Search", "Reset search and filters"],
  ["Payout reports", "Search", "Reset search and filters"],
  ["Companies", "Search companies", "Clear search"],
  ["Current fees", "Search SKUs", "Clear search"],
]) {
  test(`${tab} empty-result recovery keeps keyboard focus in its search`, async ({ page }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.assignments = [skuAssignment(1)];
    await signIn(page);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    const search = page.getByLabel(label, { exact: true });
    await search.fill("NOT-A-MATCH-ANYWHERE");
    const reset = page.getByRole("button", { name: recovery, exact: true }).last();
    await expect(reset).toBeVisible();
    await reset.focus();
    await page.keyboard.press("Enter");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await page.keyboard.type("Amazon");
    await expect(search).toHaveValue("Amazon");
  });
}

for (const [column, option, searchLabel] of [
  ["Marketplace", "Amazon.com", "Search marketplace"],
  ["Source", "Finances", null],
]) {
  test(`clearing ${column} choices keeps keyboard focus inside the menu`, async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    const menu = await openColumn(page, column);
    await menu.getByRole("checkbox", { name: option, exact: true }).check();
    await menu.getByRole("button", { name: `Clear ${column.toLowerCase()}`, exact: true }).focus();
    await page.keyboard.press("Enter");
    const target = searchLabel
      ? menu.getByLabel(searchLabel, { exact: true })
      : menu.getByRole("checkbox").first();
    await expect(target).toBeFocused();
    await expect(menu.getByRole("checkbox", { name: option, exact: true })).not.toBeChecked();
  });
}

test("type match actions and clear keep keyboard focus in the option search", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);
  const menu = await openColumn(page, "Type");
  const search = menu.getByLabel("Search type", { exact: true });
  await search.fill("refund");
  for (const action of ["Select matches", "Deselect matches", "Select matches", "Clear type"]) {
    const button = menu.getByRole("button", { name: action, exact: true });
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
  }
});

for (const target of ["column", "summary"]) {
  test(`${target} date validation identifies and focuses the invalid range`, async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    let dialog;
    if (target === "column") dialog = await openColumn(page, "Date (UTC)");
    else {
      await page.getByRole("button", { name: "Choose dates · UTC", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
    }
    const from = dialog.getByLabel("From date", { exact: true });
    const to = dialog.getByLabel("To date", { exact: true });
    await from.fill("2026-07-31");
    await to.fill("2026-07-01");
    await dialog.getByRole("button", { name: "Apply dates", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toHaveText("From date must be on or before To date.");
    await expect(from).toBeFocused();
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(from).toHaveAccessibleDescription("From date must be on or before To date.");
    await from.fill("2026-07-01");
    await expect(from).not.toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}
