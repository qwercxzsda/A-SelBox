import { expect, test } from "@playwright/test";
import { skuAssignment } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

async function closeMenu(menu) {
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

for (const role of ["company_member", "operator"]) {
  test(`${role} keeps complete static options available with zero matching transactions`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.liveRows = [];
    await signIn(page);
    const preloadRequests = fixture.optionRequests.length;
    await page.getByLabel("Search", { exact: true }).fill("ZERO RESULT");
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();

    const source = await openColumn(page, "Source");
    await expect(source.getByRole("checkbox")).toHaveCount(2);
    await expect(source.getByLabel("Search source", { exact: true })).toHaveCount(0);
    await source.getByRole("checkbox", { name: "Data Kiosk", exact: true }).check();
    await closeMenu(source);

    const marketplace = await openColumn(page, "Marketplace");
    await expect(marketplace.getByRole("checkbox")).toHaveCount(24);
    await marketplace.getByLabel("Search marketplace", { exact: true }).fill("co.za");
    await expect(marketplace.getByRole("checkbox")).toHaveCount(1);
    await marketplace.getByRole("checkbox", { name: "Amazon.co.za", exact: true }).check();
    await marketplace.getByLabel("Search marketplace", { exact: true }).fill("NO MATCH");
    await expect(marketplace.getByText("No matching options.", { exact: true })).toBeVisible();
    await closeMenu(marketplace);

    const type = await openColumn(page, "Type");
    await expect(
      type.getByRole("checkbox", {
        name: "Other transaction · Other transaction · Subscription fee",
        exact: true,
      }),
    ).toHaveCount(role === "operator" ? 1 : 0);
    await expect(
      type.getByRole("checkbox", {
        name: "FBA fees · FBA inventory storage fee · Base fee",
        exact: true,
      }),
    ).toBeVisible();
    await type.getByLabel("Search type", { exact: true }).fill("product sales");
    await type.getByRole("checkbox", { name: "Product sales", exact: true }).check();
    await closeMenu(type);
    const selectedType = await openColumn(page, "Type");
    await expect(
      selectedType.getByRole("checkbox", { name: "Product sales", exact: true }),
    ).toBeChecked();
    await closeMenu(selectedType);
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
    expect(fixture.optionRequests).toHaveLength(preloadRequests);
    expect(fixture.requests.at(-1).args.p_types).toEqual(["PRODUCT_SALES"]);
    expect(fixture.requests.at(-1).args.p_marketplaces).toEqual(["Amazon.co.za"]);
    expect(fixture.requests.at(-1).args.p_sources).toEqual(["DATA_KIOSK"]);

    if (role === "operator") {
      for (const tab of ["Settlements", "Data Kiosk"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const rawType = await openColumn(page, "Type");
        await expect(rawType.getByLabel("Search type", { exact: true })).toBeVisible();
        await expect(rawType.getByRole("checkbox").first()).toBeVisible();
        await closeMenu(rawType);
        const rawMarketplace = await openColumn(page, "Marketplace");
        await expect(rawMarketplace.getByRole("checkbox")).toHaveCount(24);
        await closeMenu(rawMarketplace);
      }
      expect(fixture.optionRequests).toHaveLength(preloadRequests);
    }
  });
}

test("member SKU options use complete assignments, deduplicate exact keys, and search without facts", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.liveRows = [];
  fixture.assignments = Array.from({ length: 10 }, (_, index) => skuAssignment(index + 1));
  fixture.assignments.push({ ...skuAssignment(11), sku: "GROUP-001" });
  await signIn(page);
  const menu = await openColumn(page, "SKU");
  await expect(menu.getByRole("checkbox")).toHaveCount(10);
  await menu.getByLabel("Search sku", { exact: true }).fill("GROUP-010");
  await expect(menu.getByRole("checkbox")).toHaveCount(1);
  await menu.getByRole("checkbox", { name: "GROUP-010", exact: true }).check();
  await closeMenu(menu);
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  const reopened = await openColumn(page, "SKU");
  await expect(reopened.getByRole("checkbox", { name: "GROUP-010", exact: true })).toBeChecked();
  expect(fixture.optionRequests).toHaveLength(0);
  expect(fixture.requests.at(-1).args.p_skus).toEqual(["GROUP-010"]);
  fixture.assignments = [skuAssignment(1)];
  fixture.revisions.fees = "1";
  await page.clock.fastForward(60_000);
  await expect(reopened.getByRole("checkbox")).toHaveCount(2);
  await expect(reopened.getByRole("checkbox", { name: "GROUP-010", exact: true })).toBeChecked();
  expect(fixture.optionRequests).toHaveLength(0);
});
