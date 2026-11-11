import { expect } from "@playwright/test";

function columnName(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?: [0-9]+ selected)?$`);
}

export function columnTrigger(scope, label) {
  return scope.getByRole("button", { name: columnName(label) });
}

export function columnHeader(scope, label) {
  return scope.getByRole("columnheader", { name: columnName(label) });
}

export async function openColumn(page, label) {
  await columnTrigger(page, label).click();
  const menu = page.getByRole("dialog", { name: `${label} options`, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function sortBy(page, label, direction) {
  const menu = await openColumn(page, label);
  await menu.getByRole("button", { name: direction, exact: true }).click();
}

export async function applyDates(page, from = "", to = "") {
  const menu = await openColumn(page, "Date (UTC)");
  await menu.getByLabel("From date", { exact: true }).fill(from);
  await menu.getByLabel("To date", { exact: true }).fill(to);
  await menu.getByRole("button", { name: "Apply dates", exact: true }).click();
}

export async function applySummaryDates(page, from = "", to = "") {
  await page
    .getByRole("article", { name: "Selected dates totals", exact: true })
    .getByRole("button", { name: /^(Choose dates · UTC|Change dates: )/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
  await dialog.getByLabel("From date", { exact: true }).fill(from);
  await dialog.getByLabel("To date", { exact: true }).fill(to);
  await dialog.getByRole("button", { name: "Apply dates", exact: true }).click();
}

export async function applyReportMonth(page, month) {
  const menu = await openColumn(page, "Month");
  await menu.getByLabel("Report month", { exact: true }).fill(month);
  await menu.getByRole("button", { name: "Apply month", exact: true }).click();
}

export async function selectColumnOptions(page, column, options) {
  const menu = await openColumn(page, column);
  for (const option of options) {
    await menu.getByRole("checkbox", { name: option, exact: true }).check();
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}
