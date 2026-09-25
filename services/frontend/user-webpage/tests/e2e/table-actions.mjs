import { expect } from "@playwright/test";

export async function openColumn(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const menu = page.getByRole("dialog", { name: `${label} options`, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function sortBy(page, label, direction) {
  const menu = await openColumn(page, label);
  await menu.getByRole("button", { name: direction, exact: true }).click();
}

export async function applyDates(page, from = "", to = "") {
  const menu = await openColumn(page, "Date");
  await menu.getByLabel("From date", { exact: true }).fill(from);
  await menu.getByLabel("To date", { exact: true }).fill(to);
  await menu.getByRole("button", { name: "Apply dates", exact: true }).click();
}
