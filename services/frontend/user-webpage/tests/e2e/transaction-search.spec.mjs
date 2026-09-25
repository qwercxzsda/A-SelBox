import { expect, test } from "@playwright/test";
import { DATASET_CONFIG } from "../../src/api/config.ts";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["settlement", "Settlements"],
  ["data_kiosk", "Data Kiosk"],
]) {
  test(`${tab} searches every supported text field through page and count RPCs`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    const cases = DATASET_CONFIG[dataset].searchColumns.map((field, index) => {
      const term =
        { source: "SETTLEMENT", currency: "USD", marketplace_name: "Amazon.co.jp" }[field] ??
        `Needle_${field}%*.\\"(한글)`;
      const base =
        dataset === "live"
          ? liveRow("SEARCH", index + 1)
          : dataset === "settlement"
            ? settlementRow(index + 1)
            : kioskRow(index + 1, "10");
      return {
        field,
        term,
        row: {
          ...base,
          source: "DATA_KIOSK",
          currency: "EUR",
          marketplace_name: "Amazon.com",
          sku: `SEARCH-${index}`,
          component_type: "OTHER",
          resolution_status: "MISSING_FEE",
          family: "family-only",
          accounting_subtype: "OPERATING_EXPENSE",
          [field]: term,
        },
      };
    });
    if (dataset === "live") fixture.liveRows = cases.map(({ row }) => row);
    else if (dataset === "settlement") fixture.settlementRows = cases.map(({ row }) => row);
    else fixture.kioskRows = cases.map(({ row }) => row);
    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    for (const { term, row } of cases) {
      const search = term.toLowerCase();
      await page.getByLabel("Search", { exact: true }).fill(` ${search} `);
      await expect.poll(() => fixture.requests.at(-1).args?.p_search).toBe(search);
      await expect.poll(() => fixture.countRequests.at(-1).args?.p_search).toBe(search);
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table.getByRole("cell", { name: row.sku, exact: true })).toBeVisible();
      expect(fixture.requests.at(-1).transport).toBe("rpc");
      expect(fixture.countRequests.at(-1).transport).toBe("rpc");
    }
    if (dataset === "live") {
      for (const [label, count] of [
        ["Data Kiosk", cases.length - 1],
        ["Settlements", 1],
      ]) {
        await page.getByLabel("Search", { exact: true }).fill(label);
        await expect.poll(() => fixture.requests.at(-1).args?.p_search).toBe(label);
        await expect(table.getByRole("row")).toHaveCount(count + 1);
      }
    }
    for (const hidden of [
      "synthetic-seller",
      "v0",
      "missing_fee",
      "document-1",
      "family-only",
      "OPERATING_EXPENSE",
      ...(dataset === "live" ? [] : ["DATA_KIOSK", "Data Kiosk", "Settlements"]),
    ]) {
      await page.getByLabel("Search", { exact: true }).fill(hidden);
      await expect.poll(() => fixture.requests.at(-1).args?.p_search).toBe(hidden);
      await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
      await expect(table.getByRole("row")).toHaveCount(1);
    }
    await page.getByLabel("Search", { exact: true }).clear();
    await expect(table.getByRole("row")).toHaveCount(cases.length + 1);
  });
}
