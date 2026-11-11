import { expect } from "@playwright/test";

export const companyCreation = (page) =>
  page.getByRole("dialog", { name: "Add company", exact: true });

export function companyToggle(page, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", { name: new RegExp(`^(Show|Hide) details for ${escaped}:`) });
}

export const companyPanel = (page, name) =>
  page.getByRole("region", { name: `Company details for ${name}`, exact: true });

export const companyRow = (page, name) =>
  page.getByRole("row").filter({ has: companyToggle(page, name) });

export async function closeCompanyCreation(page) {
  await companyCreation(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(companyCreation(page)).toBeHidden();
}
