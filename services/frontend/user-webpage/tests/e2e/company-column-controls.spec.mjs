import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { skuAssignment } from "./api-fixtures.mjs";
import { columnHeader, openColumn, sortBy } from "./table-actions.mjs";
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
const names = (page) => companies(page).locator(".inspectable-row .list-row-name");
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

test("company controls offer ordering only while search and deduplicated SKU ordering persist through paging and reload", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  const search = page.getByLabel("Search companies", { exact: true });
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  const menu = await openColumn(page, "Company");
  await expect(menu.getByRole("button", { name: "A to Z", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Z to A", exact: true })).toBeVisible();
  await expect(menu.getByRole("checkbox")).toHaveCount(0);
  await expect(menu.getByRole("textbox")).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Clear company", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Applied company filters", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(summary(page)).toHaveText("26–30 of 30 companies");

  await sortBy(page, "Assigned SKUs", "Highest first");
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await expect(names(page).nth(0)).toHaveText("Gamma Company");
  await expect(names(page).nth(1)).toHaveText("Alpha Company");
  await expect(names(page).nth(2)).toHaveText("Beta Company");
  await expect(companyRow(page, "Alpha Company").locator(".numeric")).toHaveText("2");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await search.fill("Company");
  await expect(names(page)).toHaveText([
    "Gamma Company",
    "Alpha Company",
    "Beta Company",
    "Zero Company",
  ]);
  await expect(summary(page)).toHaveText("1–4 of 4 companies");
  await page.reload();
  await expect(names(page)).toHaveText([
    "Gamma Company",
    "Alpha Company",
    "Beta Company",
    "Zero Company",
  ]);
  await expect(search).toHaveValue("Company");
  await expect(columnHeader(companies(page), "Assigned SKUs")).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  await search.fill("Alpha");
  await expect(names(page)).toHaveText(["Alpha Company"]);
  await expect(summary(page)).toHaveText("1 company");
  await search.fill("No such company");
  await expect(page.getByText("No matching companies", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "Companies table", exact: true })
    .getByRole("button", { name: "Reset search", exact: true })
    .press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await expect(names(page).first()).toHaveText("Gamma Company");
  await expect(columnHeader(companies(page), "Assigned SKUs")).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  await search.fill("Company");
  await sortBy(page, "Company", "Z to A");
  await expect(names(page)).toHaveText([
    "Zero Company",
    "Gamma Company",
    "Beta Company",
    "Alpha Company",
  ]);
  await page.reload();
  await expect(names(page)).toHaveText([
    "Zero Company",
    "Gamma Company",
    "Beta Company",
    "Alpha Company",
  ]);
  await expect(search).toHaveValue("Company");
  await expect(columnHeader(companies(page), "Company")).toHaveAttribute("aria-sort", "descending");
  await sortBy(page, "Company", "A to Z");
  await expect(names(page)).toHaveText([
    "Alpha Company",
    "Beta Company",
    "Gamma Company",
    "Zero Company",
  ]);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(summary(page)).toHaveText("1–25 of 30 companies");
  await expect(names(page).first()).toHaveText("Alpha Company");
  await expect(columnHeader(companies(page), "Company")).toHaveAttribute("aria-sort", "ascending");
  expect(fixture.companyCreationRequests).toHaveLength(0);
  expect(fixture.companyDeletionRequests).toHaveLength(0);
});

test("each company shows its creation time in UTC and the list orders by it", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-b"] = BETA;
  fixture.companyNames = {
    [ALPHA]: "Alpha Company",
    [BETA]: "Beta Company",
    [GAMMA]: "Gamma Company",
  };
  fixture.companyCreatedAt = {
    [ALPHA]: "2026-03-01T09:00:00Z",
    [BETA]: "2026-01-15 08:30:00+00",
    [GAMMA]: "2026-02-01T23:59:59.5+09:00",
  };
  await signIn(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  const created = (name) => companyRow(page, name).getByRole("cell").nth(2);
  await expect(created("Alpha Company")).toHaveText("2026-03-01 09:00:00");
  await expect(created("Beta Company")).toHaveText("2026-01-15 08:30:00");
  await expect(created("Gamma Company")).toHaveText("2026-02-01 14:59:59");
  await expect(created("Beta Company").locator("time")).toHaveAttribute(
    "datetime",
    "2026-01-15 08:30:00+00",
  );

  await sortBy(page, "Created (UTC)", "Oldest first");
  await expect(names(page)).toHaveText(["Beta Company", "Gamma Company", "Alpha Company"]);
  await expect(columnHeader(companies(page), "Created (UTC)")).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await sortBy(page, "Created (UTC)", "Newest first");
  await expect(names(page)).toHaveText(["Alpha Company", "Gamma Company", "Beta Company"]);
  await page.reload();
  await expect(names(page)).toHaveText(["Alpha Company", "Gamma Company", "Beta Company"]);
  await expect(columnHeader(companies(page), "Created (UTC)")).toHaveAttribute(
    "aria-sort",
    "descending",
  );
});

test("company rows open a detail drawer by pointer or keyboard and restore focus on close", async ({
  page,
}) => {
  await setup(page);
  await expect(companies(page).getByRole("columnheader")).toHaveText([
    /^Company/,
    /^Assigned SKUs/,
    /^Created \(UTC\)/,
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

test("long company lists offer bottom paging and a focused return to controls", async ({
  page,
}) => {
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
  await bottom.getByRole("button", { name: "Back to company controls", exact: true }).click();
  await expect(controls).toBeFocused();
  await expect(controls).toBeInViewport();
});

test("View members opens company-filtered access and returns to the company list", async ({
  page,
}) => {
  const fixture = await setup(page);
  await companyRow(page, "Beta Company").click();
  await companyDrawer(page).getByRole("button", { name: "View members", exact: true }).click();
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
