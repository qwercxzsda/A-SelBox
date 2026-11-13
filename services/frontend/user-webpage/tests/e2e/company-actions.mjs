import { expect } from "@playwright/test";

export const companyCreation = (page) =>
  page.getByRole("dialog", { name: "Add company", exact: true });

export const companyPanel = (page, name) =>
  page.getByRole("region", { name: `Company details for ${name}`, exact: true });

export const companyRow = (page, name) =>
  page
    .getByRole("table", { name: "Companies", exact: true })
    .getByRole("row")
    .filter({
      has: page.getByText(name, { exact: true }),
    });

export const companyDrawer = (page) =>
  page.getByRole("dialog", { name: "Company details", exact: true });

export async function closeCompanyDetails(page) {
  await companyDrawer(page)
    .getByRole("button", { name: "Close company details", exact: true })
    .click();
  await expect(companyDrawer(page)).toBeHidden();
}

export async function closeCompanyCreation(page) {
  await companyCreation(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(companyCreation(page)).toBeHidden();
}
