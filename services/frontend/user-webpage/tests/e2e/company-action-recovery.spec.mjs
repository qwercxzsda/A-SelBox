import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import { item, setup } from "./sku-configuration-fixtures.mjs";

const unusedCompany = "0198b50b-701a-7000-8000-000000000800";
const creation = (page) => page.getByRole("region", { name: "Add company", exact: true });

async function openCompanies(page) {
  const fixture = await setup(page, "administrator", [item("S1")], (fixture) => {
    fixture.companyNames[unusedCompany] = "Unused Company";
  });
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  return fixture;
}

test("company creation returns keyboard focus to failure and success feedback", async ({
  page,
}) => {
  const fixture = await openCompanies(page);
  const form = creation(page);
  fixture.companyCreationStatus = 503;
  await form.getByLabel("Company name", { exact: true }).fill("Recovery Company");
  await form.getByLabel("Company name", { exact: true }).press("Enter");
  await expect(form.getByRole("alert")).toBeFocused();
  await expect(form.getByLabel("Company name", { exact: true })).toHaveValue("Recovery Company");
  fixture.companyCreationStatus = 200;
  await form.getByRole("button", { name: "Create company", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Company added: Recovery Company");
  await expect(form.getByRole("status")).toBeFocused();
  expect(fixture.companyCreationRequests).toHaveLength(2);
});

test("company creation feedback does not interrupt work in the company search", async ({
  page,
}) => {
  const fixture = await openCompanies(page);
  const response = deferred();
  fixture.beforeCompanyCreation = () => response.promise;
  await creation(page).getByLabel("Company name", { exact: true }).fill("Background Company");
  await creation(page).getByRole("button", { name: "Create company", exact: true }).click();
  const search = page.getByLabel("Search companies", { exact: true });
  await search.fill("Alpha");
  response.resolve();
  await expect(creation(page).getByRole("status")).toBeVisible();
  await expect(search).toBeFocused();
  expect(fixture.companyCreationRequests).toHaveLength(1);
});

test("a blocked company deletion focuses its explanation and can be cancelled by keyboard", async ({
  page,
}) => {
  const fixture = await openCompanies(page);
  fixture.companyDeletionBlockers[unusedCompany] = [{ code: "members", count: 2 }];
  await page.getByRole("button", { name: "Show details for Unused Company", exact: true }).click();
  const details = page.getByRole("region", {
    name: "Show details for Unused Company",
    exact: true,
  });
  await expect(details).toHaveCSS("overflow", "visible");
  await details.getByRole("button", { name: "Delete company", exact: true }).click();
  const confirmation = page.getByRole("region", { name: "Delete Unused Company", exact: true });
  await confirmation.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toContainText("Members: 2");
  await expect(confirmation.getByRole("alert")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(details.getByRole("button", { name: "Delete company", exact: true })).toBeFocused();
  expect(fixture.companyDeletionRequests).toHaveLength(1);
  expect(fixture.companyNames[unusedCompany]).toBe("Unused Company");
});
