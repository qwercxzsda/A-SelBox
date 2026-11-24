import { expect, test } from "@playwright/test";
import { liveRow, financesRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["finances", "Finances"],
]) {
  test(`${tab} resolves literal case-insensitive search into exact sets without currency or metadata matches`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    const type = "PRODUCT_SALES";
    const fields = [
      ["sku", 'Needle_%*.\\"(sample)', "p_search_skus"],
      ["component_type", type, "p_search_types"],
      ["marketplace_name", "Amazon.co.jp", "p_search_marketplaces"],
      ...(dataset === "live" ? [["source", "FINANCES", "p_search_sources"]] : []),
    ];
    const cases = fields.map(([field, term, argument], index) => ({
      term,
      argument,
      row: {
        ...(dataset === "live" ? liveRow("SEARCH", index + 1) : financesRow(index + 1)),
        source: "STORAGE",
        currency: "USD",
        marketplace_name: "Amazon.com",
        sku: `SEARCH-${index}`,
        component_type: "PRODUCT_REFUNDS",
        resolution_status: "MISSING_FEE",
        native_transaction_id: "native-only",
        selbox_group: "ACCOUNT_FEE",
        [field]: term,
      },
    }));
    if (dataset === "live") fixture.liveRows = cases.map(({ row }) => row);
    else fixture.financesRows = cases.map(({ row }) => row);

    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    for (const { term, argument, row } of cases) {
      await page.getByLabel("Search", { exact: true }).fill(` ${term.toLowerCase()} `);
      await expect.poll(() => fixture.requests.at(-1).args?.[argument]).toContain(term);
      await expect.poll(() => fixture.countRequests.at(-1).args?.[argument]).toContain(term);
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table.getByRole("cell", { name: row.sku, exact: true })).toBeVisible();
      expect(fixture.requests.at(-1).args).not.toHaveProperty("p_search");
    }
    if (dataset === "live") {
      await page.getByLabel("Search", { exact: true }).fill("Monthly storage report");
      await expect.poll(() => fixture.requests.at(-1).args.p_search_sources).toEqual(["STORAGE"]);
      await expect(table.getByRole("row")).toHaveCount(cases.length);
    }
    for (const hidden of [
      "USD",
      "synthetic-seller",
      "v0",
      "missing_fee",
      "document-1",
      "native-only",
      "ACCOUNT_FEE",
      ...(dataset === "live" ? [] : ["REMOVAL_ORDER", "Monthly storage report", "Finances"]),
    ]) {
      const previous = fixture.requests.length;
      await page.getByLabel("Search", { exact: true }).fill(hidden);
      await expect.poll(() => fixture.requests.length).toBeGreaterThan(previous);
      await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
      await expect(table.getByRole("row")).toHaveCount(1);
      const args = fixture.requests.at(-1).args;
      for (const key of [
        "p_search_skus",
        "p_search_types",
        "p_search_marketplaces",
        ...(dataset === "live" ? ["p_search_sources"] : []),
      ])
        expect(args[key]).toEqual([]);
    }
    await page.getByLabel("Search", { exact: true }).clear();
    await expect(table.getByRole("row")).toHaveCount(cases.length + 1);
  });
}

test("search combines SKU and displayed Type matches with OR before applying column filters", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.liveRows = [
    { ...liveRow("FEE-UNREGISTERED", 1), component_type: "PRODUCT_SALES" },
    { ...liveRow("STORAGE", 1), source: "STORAGE", component_type: "STORAGE_FEES" },
    { ...liveRow("OTHER", 1), component_type: "PRODUCT_SALES" },
  ];
  await signIn(page);
  await page.getByLabel("Search", { exact: true }).fill(" fee ");
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  await expect(table.getByRole("row")).toHaveCount(3);
  expect(fixture.requests.at(-1).args.p_search_skus).toEqual(["FEE-UNREGISTERED-001"]);
  expect(fixture.requests.at(-1).args.p_search_types).toContain("STORAGE_FEES");
  const menu = await openColumn(page, "SKU");
  await menu.getByRole("checkbox", { name: "FEE-UNREGISTERED-001", exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  expect(fixture.requests.at(-1).args.p_skus).toEqual(["FEE-UNREGISTERED-001"]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("storage fee");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("cell", { name: "STORAGE-001", exact: true })).toBeVisible();
});
