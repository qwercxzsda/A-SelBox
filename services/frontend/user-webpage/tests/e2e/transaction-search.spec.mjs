import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["settlement", "Settlements"],
  ["data_kiosk", "Data Kiosk"],
]) {
  test(`${tab} resolves literal case-insensitive search into exact sets without currency or metadata matches`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    const type = dataset === "data_kiosk" ? "FBA_STORAGE_FEE" : "PRODUCT_SALES";
    const fields = [
      ["sku", 'Needle_%*.\\"(sample)', "p_search_skus"],
      ["component_type", type, "p_search_types"],
      ["marketplace_name", "Amazon.co.jp", "p_search_marketplaces"],
      ...(dataset === "live" ? [["source", "SETTLEMENT", "p_search_sources"]] : []),
    ];
    const cases = fields.map(([field, term, argument], index) => ({
      term,
      argument,
      row: {
        ...(dataset === "live"
          ? liveRow("SEARCH", index + 1)
          : dataset === "settlement"
            ? settlementRow(index + 1)
            : kioskRow(index + 1, "10")),
        source: "DATA_KIOSK",
        currency: "USD",
        marketplace_name: "Amazon.com",
        sku: `SEARCH-${index}`,
        component_type: dataset === "data_kiosk" ? "COST_OF_GOODS_SOLD" : "PRODUCT_REFUNDS",
        resolution_status: "MISSING_FEE",
        family: "family-only",
        accounting_subtype: "OPERATING_EXPENSE",
        [field]: term,
      },
    }));
    if (dataset === "live") fixture.liveRows = cases.map(({ row }) => row);
    else if (dataset === "settlement") fixture.settlementRows = cases.map(({ row }) => row);
    else fixture.kioskRows = cases.map(({ row }) => row);
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
      await page.getByLabel("Search", { exact: true }).fill("Data Kiosk");
      await expect
        .poll(() => fixture.requests.at(-1).args.p_search_sources)
        .toEqual(["DATA_KIOSK"]);
      await expect(table.getByRole("row")).toHaveCount(cases.length);
    }
    for (const hidden of [
      "USD",
      "synthetic-seller",
      "v0",
      "missing_fee",
      "document-1",
      "family-only",
      "OPERATING_EXPENSE",
      ...(dataset === "live" ? [] : ["DATA_KIOSK", "Data Kiosk", "Settlements"]),
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
  fixture.roles["member-a"] = "operator";
  fixture.liveRows = [
    { ...liveRow("FBA-UNREGISTERED", 1), component_type: "PRODUCT_SALES" },
    { ...liveRow("STORAGE", 1), source: "DATA_KIOSK", component_type: "FBA_STORAGE_FEE" },
    { ...liveRow("OTHER", 1), component_type: "PRODUCT_SALES" },
  ];
  await signIn(page);
  await page.getByLabel("Search", { exact: true }).fill(" fba ");
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  await expect(table.getByRole("row")).toHaveCount(3);
  expect(fixture.requests.at(-1).args.p_search_skus).toEqual(["FBA-UNREGISTERED-001"]);
  expect(fixture.requests.at(-1).args.p_search_types).toContain("FBA_STORAGE_FEE");
  const menu = await openColumn(page, "SKU");
  await menu.getByRole("checkbox", { name: "FBA-UNREGISTERED-001", exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  expect(fixture.requests.at(-1).args.p_skus).toEqual(["FBA-UNREGISTERED-001"]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("storage fee");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("cell", { name: "STORAGE-001", exact: true })).toBeVisible();
});
