import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { skuAssignment } from "./api-fixtures.mjs";
import { columnHeader, openColumn, selectColumnOptions, sortBy } from "./table-actions.mjs";
import {
  closeCompanyDetails,
  companyDrawer,
  companyPanel,
  companyRow,
} from "./company-actions.mjs";

const ALPHA = "00000000-0000-4000-8000-000000000101";
const BETA = "00000000-0000-4000-8000-000000000102";
const GAMMA = "00000000-0000-4000-8000-000000000103";
const ZERO = "00000000-0000-4000-8000-000000000104";
const companies = (page) => page.getByRole("table", { name: "Companies", exact: true });
const names = (page) => companies(page).locator(".inspectable-row .company-list-name");
const summary = (page) =>
  page
    .getByRole("navigation", { name: "Companies pagination", exact: true })
    .locator(".pagination-summary");

async function setup(page, many = false) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-b"] = BETA;
  fixture.companyNames = {
    [ALPHA]: "Alpha Company",
    [BETA]: "Beta Company",
    [GAMMA]: "Gamma Company",
    [ZERO]: "Zero Company",
  };
  if (many)
    for (let index = 1; index <= 26; index++)
      fixture.companyNames[`00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`] =
        `Extra ${String(index).padStart(2, "0")}`;
  fixture.assignments = [
    [ALPHA, "ALPHA-1"],
    [ALPHA, "ALPHA-2"],
    [ALPHA, "ALPHA-1"],
    [BETA, "BETA-1"],
    [GAMMA, "GAMMA-1"],
    [GAMMA, "GAMMA-2"],
    [GAMMA, "GAMMA-3"],
  ].map(([company_id, sku], index) => ({ ...skuAssignment(index + 1), company_id, sku }));
  await signIn(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await expect(companies(page)).toBeVisible();
  return fixture;
}

test("company filters and deduplicated SKU ordering apply before paging and survive reload", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  const search = page.getByLabel("Search companies", { exact: true });
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(summary(page)).toHaveText("26–30 of 30 companies");

  await sortBy(page, "Assigned SKUs", "Highest first");
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await expect(names(page).nth(0)).toHaveText("Gamma Company");
  await expect(names(page).nth(1)).toHaveText("Alpha Company");
  await expect(names(page).nth(2)).toHaveText("Beta Company");
  await expect(companyRow(page, "Alpha Company").locator(".numeric")).toHaveText("2");

  await selectColumnOptions(page, "Company", ["Alpha Company", "Gamma Company"]);
  await expect(names(page)).toHaveText(["Gamma Company", "Alpha Company"]);
  await expect(summary(page)).toHaveText("1–2 of 2 companies");
  await search.fill("Company");
  const applied = page.getByRole("group", { name: "Applied company filters", exact: true });
  await applied
    .getByRole("button", { name: "Remove Company: Alpha Company", exact: true })
    .press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Company");
  await expect(names(page)).toHaveText(["Gamma Company"]);
  await expect(summary(page)).toHaveText("1–1 of 1 companies");
  await expect(
    applied.getByRole("button", { name: "Remove Company: Alpha Company", exact: true }),
  ).toHaveCount(0);
  await expect(
    applied.getByRole("button", { name: "Remove Company: Gamma Company", exact: true }),
  ).toBeVisible();
  await expect(columnHeader(companies(page), "Assigned SKUs")).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await selectColumnOptions(page, "Company", ["Alpha Company"]);
  await expect(names(page)).toHaveText(["Gamma Company", "Alpha Company"]);
  await page.reload();
  await expect(names(page)).toHaveText(["Gamma Company", "Alpha Company"]);
  await expect(search).toHaveValue("Company");
  await expect(columnHeader(companies(page), "Assigned SKUs")).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await search.fill("Alpha");
  await expect(names(page)).toHaveText(["Alpha Company"]);
  await expect(summary(page)).toHaveText("1–1 of 1 companies");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(names(page)).toHaveText(["Gamma Company", "Alpha Company"]);

  await sortBy(page, "Company", "A to Z");
  await expect(names(page)).toHaveText(["Alpha Company", "Gamma Company"]);
  await page.reload();
  await expect(names(page)).toHaveText(["Alpha Company", "Gamma Company"]);
  await expect(columnHeader(companies(page), "Company")).toHaveAttribute("aria-sort", "ascending");
  const menu = await openColumn(page, "Company");
  for (const name of ["Alpha Company", "Gamma Company"])
    await expect(menu.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await menu.getByRole("button", { name: "Clear company", exact: true }).click();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await expect(names(page).first()).toHaveText("Alpha Company");
  expect(fixture.companyCreationRequests).toHaveLength(0);
  expect(fixture.companyDeletionRequests).toHaveLength(0);
});

test("company rows open a detail drawer by pointer or keyboard and restore focus on close", async ({
  page,
}) => {
  await setup(page);
  await expect(companies(page).getByRole("columnheader")).toHaveText([
    /^Company/,
    /^Assigned SKUs/,
  ]);
  await companyRow(page, "Alpha Company").getByText("Alpha Company", { exact: true }).click();
  await expect(companyPanel(page, "Alpha Company")).toBeVisible();
  await expect(companyDrawer(page)).toBeVisible();
  await closeCompanyDetails(page);
  await expect(companyRow(page, "Alpha Company")).toBeFocused();
  await companyRow(page, "Beta Company").focus();
  await page.keyboard.press("Space");
  await expect(companyPanel(page, "Alpha Company")).toHaveCount(0);
  await expect(companyPanel(page, "Beta Company")).toBeVisible();
  await page.reload();
  await expect(companyPanel(page, "Beta Company")).toBeVisible();
  await closeCompanyDetails(page);
  await companyRow(page, "Alpha Company").press("Enter");
  await expect(companyPanel(page, "Alpha Company")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(companyDrawer(page)).toBeHidden();
  await expect(companyRow(page, "Alpha Company")).toBeFocused();
});

test("long company lists offer bottom paging and a focused return to filters", async ({ page }) => {
  await setup(page, true);
  const controls = page.getByRole("group", { name: "Company list controls", exact: true });
  const bottom = page.getByRole("navigation", {
    name: "Company list navigation at bottom",
    exact: true,
  });
  await bottom.getByRole("button", { name: "Next companies", exact: true }).click();
  await expect(summary(page)).toHaveText("26–30 of 30 companies");
  await expect(controls).toBeFocused();
  await expect(controls).toBeInViewport();
  await bottom.getByRole("button", { name: "Previous companies", exact: true }).click();
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await bottom.getByRole("button", { name: "Back to company filters", exact: true }).click();
  await expect(controls).toBeFocused();
  await expect(controls).toBeInViewport();
});

test("View members opens company-filtered access and returns to the company list", async ({
  page,
}) => {
  const fixture = await setup(page);
  await companyRow(page, "Beta Company").click();
  await companyPanel(page, "Beta Company")
    .getByRole("button", { name: "View members", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect
    .poll(() =>
      fixture.requests
        .filter(({ dataset }) => dataset === "accounts")
        .at(-1)
        ?.params.get("company_id"),
    )
    .toBe(`in.(${BETA})`);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await expect(companyDrawer(page)).toBeHidden();
  await expect(companyRow(page, "Beta Company")).toBeVisible();
});
