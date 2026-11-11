import { expect, test } from "./accessibility-fixture.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { columnHeader, columnTrigger, openColumn, selectColumnOptions } from "./table-actions.mjs";

const ALPHA = "10000000-0000-0000-0000-000000000001";
const BETA = "10000000-0000-0000-0000-000000000002";
const records = (page) => page.getByRole("table", { name: "Inventory records", exact: true });
const pagination = (page) =>
  page.getByRole("navigation", { name: "Inventory pagination, top", exact: true });
const filters = (page) =>
  page.getByRole("group", { name: "Applied inventory filters", exact: true });

async function setup(page, rows, role = "administrator", search = "") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = ALPHA;
  fixture.companyIds["member-b"] = BETA;
  fixture.companyNames = { [ALPHA]: "Alpha company", [BETA]: "Beta company" };
  await mockInventory(page, rows);
  if (search) await page.goto(`/?${search}`);
  await signIn(page);
  if (!search) await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(records(page).locator("tbody tr").first()).toBeVisible();
}

test("admin company and marketplace columns filter the complete snapshot and survive reload and history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const alpha = Array.from({ length: 39 }, (_, index) =>
    inventoryRow(`A-${String(index).padStart(3, "0")}`, {
      company_id: ALPHA,
      marketplace_name: index < 30 ? "Amazon.com" : index < 35 ? "Amazon.ca" : "Amazon.co.jp",
    }),
  );
  await setup(page, [
    ...alpha,
    ...Array.from({ length: 8 }, (_, index) => inventoryRow(`B-${index}`, { company_id: BETA })),
    inventoryRow("UNASSIGNED", { company_id: null, marketplace_name: "Amazon.ca" }),
  ]);
  await expect(columnHeader(records(page), "Company")).toBeVisible();
  await expect(columnHeader(records(page), "Marketplace")).toBeVisible();
  const first = records(page).locator("tbody tr").first();
  await expect(first.locator('[data-column="sku"]')).not.toContainText("Amazon.");
  await expect(first.locator('[data-column="company"]')).toHaveText("Alpha company");
  await expect(first.locator('[data-column="marketplace"]')).toHaveText("Amazon.com");
  await expect(page.getByRole("combobox", { name: "Marketplace", exact: true })).toHaveCount(0);

  await selectColumnOptions(page, "Company", ["Alpha company"]);
  await selectColumnOptions(page, "Marketplace", ["Amazon.com", "Amazon.ca"]);
  await expect(pagination(page)).toContainText("1–25 of 35 inventory items");
  await expect(records(page).locator("tbody tr")).toHaveCount(25);
  await pagination(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(records(page).locator("tbody tr")).toHaveCount(10);
  await expect(pagination(page)).toContainText("26–35 of 35 inventory items");
  await expect(records(page).locator('tbody [data-column="sku"]').first()).toContainText("A-025");
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("company"))
    .toEqual([JSON.stringify(ALPHA)]);
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("marketplace"))
    .toEqual(["Amazon.com", "Amazon.ca"]);

  await page.reload();
  await expect(records(page).locator("tbody tr")).toHaveCount(10);
  await expect(pagination(page)).toContainText("26–35 of 35 inventory items");
  await expect(
    pagination(page).getByRole("textbox", { name: "Page number", exact: true }),
  ).toHaveValue("2");
  await filters(page)
    .getByRole("button", { name: "Remove Marketplace: Amazon.ca", exact: true })
    .click();
  await expect(pagination(page)).toContainText("1–25 of 30 inventory items");
  await expect(
    filters(page).getByRole("button", { name: "Remove Company: Alpha company", exact: true }),
  ).toBeVisible();
  await expect(
    filters(page).getByRole("button", { name: "Remove Marketplace: Amazon.com", exact: true }),
  ).toBeVisible();
  await expect(records(page).locator("tbody tr")).toHaveCount(25);

  await page.goBack();
  await expect(pagination(page)).toContainText("26–35 of 35 inventory items");
  await expect(records(page).locator("tbody tr")).toHaveCount(10);
  await page.goForward();
  await expect(pagination(page)).toContainText("1–25 of 30 inventory items");
  await filters(page)
    .getByRole("button", { name: "Remove Company: Alpha company", exact: true })
    .click();
  await expect(pagination(page)).toContainText("1–25 of 38 inventory items");
  await expect(
    filters(page).getByRole("button", { name: "Remove Marketplace: Amazon.com", exact: true }),
  ).toBeVisible();
});

test("a member's inventory link discards company filters and exposes only the Marketplace column", async ({
  page,
}) => {
  const search = new URLSearchParams({ tab: "inventory", marketplace: "Amazon.ca" });
  search.append("company", JSON.stringify(BETA));
  search.append("company", "null");
  await setup(
    page,
    [
      inventoryRow("MEMBER-US", { company_id: ALPHA }),
      inventoryRow("MEMBER-CA", { company_id: ALPHA, marketplace_name: "Amazon.ca" }),
    ],
    "member",
    search.toString(),
  );
  await expect(records(page).locator("tbody tr")).toHaveCount(1);
  await expect(records(page).locator('tbody [data-column="sku"]')).toContainText("MEMBER-CA");
  await expect(columnHeader(records(page), "Marketplace")).toBeVisible();
  await expect(columnHeader(records(page), "Company")).toHaveCount(0);
  await expect(records(page).locator('[data-column="company"]')).toHaveCount(0);
  await expect(filters(page).getByRole("button", { name: /^Remove Company:/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("company")).toBe(false);
  await page.reload();
  await expect(records(page).locator("tbody tr")).toHaveCount(1);
  await expect(columnHeader(records(page), "Company")).toHaveCount(0);
});

test("phone column filters support unassigned inventory and keyboard recovery from an empty intersection", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [
    inventoryRow("ASSIGNED-US", { company_id: ALPHA }),
    inventoryRow("UNASSIGNED-CA", { company_id: null, marketplace_name: "Amazon.ca" }),
  ]);
  const company = columnTrigger(records(page), "Company");
  await company.scrollIntoViewIfNeeded();
  await company.focus();
  await page.keyboard.press("Enter");
  const companyMenu = page.getByRole("dialog", { name: "Company options", exact: true });
  await companyMenu.getByRole("checkbox", { name: "Unassigned", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(company).toBeFocused();
  await selectColumnOptions(page, "Marketplace", ["Amazon.com"]);
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  await expect(pagination(page)).toContainText("0–0 of 0 inventory items");
  const marketplaceMenu = await openColumn(page, "Marketplace");
  await expect(
    marketplaceMenu.getByRole("checkbox", { name: "Amazon.com", exact: true }),
  ).toBeChecked();
  await expectAccessible("inventory-marketplace-phone");
  await page.keyboard.press("Escape");
  await filters(page)
    .getByRole("button", { name: "Remove Marketplace: Amazon.com", exact: true })
    .press("Enter");
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
  await expect(records(page).locator("tbody tr")).toHaveCount(1);
  await expect(records(page).locator('tbody [data-column="sku"]')).toContainText("UNASSIGNED-CA");
  await expect(records(page).locator('tbody [data-column="company"]')).toHaveText("Unassigned");
  await expect(
    filters(page).getByRole("button", { name: "Remove Company: Unassigned", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    )
    .toBe(true);
});
