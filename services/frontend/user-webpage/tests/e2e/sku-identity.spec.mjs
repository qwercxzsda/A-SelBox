import { expect, test } from "@playwright/test";
import {
  assignmentId,
  feeRow,
  kioskRow,
  liveRow,
  settlementRow,
  skuAssignments,
} from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

const SCOPES = [
  ["company_member", "live", "Transactions"],
  ["operator", "live", "Transactions"],
  ["operator", "settlement", "Settlements"],
  ["operator", "data_kiosk", "Data Kiosk"],
];

for (const [role, dataset, tab] of SCOPES) {
  test(`${role} selects one SKU for ${tab} transactions from both source namespaces`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.assignments = skuAssignments(["S1", "S2"]);
    fixture.feeRows = [feeRow(0), { ...feeRow(1), marketplace_name: "Amazon.co.uk" }];
    const rows = [1, 2, 3].map((index) => ({
      ...(dataset === "live"
        ? liveRow("SOURCE", index)
        : dataset === "settlement"
          ? settlementRow(index)
          : kioskRow(index, String(index * 10))),
      seller_namespace: index === 1 ? "N1" : "N2",
      sku: index <= 2 ? "S1" : "S2",
      sku_id: assignmentId(index <= 2 ? 1 : 2),
      source_amount: String(index * 10),
      amount: String(index * 10),
      component_type: dataset === "data_kiosk" ? "NET_PRODUCT_SALES" : "PRODUCT_SALES",
    }));
    fixture[
      dataset === "live" ? "liveRows" : dataset === "settlement" ? "settlementRows" : "kioskRows"
    ] = rows;
    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.getByRole("row")).toHaveCount(4);
    const menu = await openColumn(page, "SKU");
    await expect(menu.getByRole("checkbox", { name: "S1", exact: true })).toHaveCount(1);
    await menu.getByRole("checkbox", { name: "S1", exact: true }).check();
    await menu.getByRole("button", { name: "Close options", exact: true }).click();
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("cell", { name: "S1", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "S2", exact: true })).toHaveCount(0);
    await expect(table).not.toContainText(/namespace|\bN[12]\b/i);
    expect(fixture.requests.at(-1).args.p_skus).toEqual(["S1"]);
    expect(Object.keys(fixture.requests.at(-1).args).some((key) => /namespace/.test(key))).toBe(
      false,
    );

    for (const [amount, namespace] of [
      ["10 USD", "N1"],
      ["20 USD", "N2"],
    ]) {
      await table.getByRole("cell", { name: amount, exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Selected row details" });
      await expect(drawer.getByRole("heading", { name: "S1", exact: true })).toBeVisible();
      if (role === "operator") {
        await expect(drawer.getByText("Source namespace", { exact: true })).toBeVisible();
        await expect(drawer.getByText(namespace, { exact: true })).toBeVisible();
      } else {
        await expect(drawer).not.toContainText(/namespace|\bN[12]\b/i);
        await expect(drawer.getByText("Additional details", { exact: true })).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Close row details", exact: true }).click();
    }

    await page.getByLabel("Search", { exact: true }).fill("S1");
    await expect.poll(() => fixture.requests.at(-1).args.p_search_skus).toEqual(["S1"]);
    await expect(table.getByRole("row")).toHaveCount(3);

    if (dataset === "live") {
      await page.getByRole("tab", { name: "Current fees", exact: true }).click();
      const sku = page.getByRole("button", { name: "Show marketplace fees for S1", exact: true });
      await expect(sku).toHaveCount(1);
      await sku.click();
      const fees = page.getByRole("table", { name: "Marketplace fees for S1", exact: true });
      await expect(fees.getByRole("row")).toHaveCount(3);
      await expect
        .poll(() => fixture.configurationRequests.filter(({ completed }) => completed).length)
        .toBe(1);
    }
  });
}
