import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { sortBy } from "./table-actions.mjs";

const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["settlement", "Settlements"],
  ["data_kiosk", "Data Kiosk"],
]) {
  test(`${tab} reverses same-date IDs across page boundaries while amount ties stay ascending`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    const records = Array.from({ length: 30 }, (_, index) => {
      const id = index + 1;
      const source = dataset === "live" && id % 2 === 0 ? "DATA_KIOSK" : "SETTLEMENT";
      const row =
        dataset === "live"
          ? liveRow("TIE", id)
          : dataset === "settlement"
            ? settlementRow(id)
            : kioskRow(id, "10");
      return {
        ...row,
        id: uuid(id),
        source_row_id: uuid(id),
        source,
        activity_date: "2026-09-01",
        posted_date: "2026-09-01",
        source_amount: "10",
        amount: "10",
        sku: `TIE-${String(id).padStart(2, "0")}`,
      };
    });
    // Deliberately scramble input so an insertion-order mock cannot pass the assertions.
    const scrambled = [
      ...records.filter((_, i) => i % 3 === 0),
      ...records.filter((_, i) => i % 3 !== 0).reverse(),
    ];
    if (dataset === "live") fixture.liveRows = scrambled;
    else if (dataset === "settlement") fixture.settlementRows = scrambled;
    else fixture.kioskRows = scrambled;
    const ascending =
      dataset === "live"
        ? [
            ...records.filter((row) => row.source === "DATA_KIOSK"),
            ...records.filter((row) => row.source === "SETTLEMENT"),
          ]
        : records;
    const skuCells = page
      .getByRole("table", { name: "Financial records", exact: true })
      .locator('tbody [data-column="sku"]');
    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();

    async function verifyBothPages(expected) {
      await expect(skuCells).toHaveText(expected.slice(0, 25).map((row) => row.sku));
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(skuCells).toHaveText(expected.slice(25).map((row) => row.sku));
      expect(fixture.requests.at(-1).args.p_offset).toBe(25);
    }

    await verifyBothPages([...ascending].reverse());
    expect(fixture.requests.at(-1).args).toMatchObject({ p_order_by: "date", p_direction: "desc" });
    await sortBy(page, "Date", "Oldest first");
    await verifyBothPages(ascending);
    expect(fixture.requests.at(-1).args).toMatchObject({ p_order_by: "date", p_direction: "asc" });
    for (const [label, direction] of [
      ["Highest first", "desc"],
      ["Lowest first", "asc"],
    ]) {
      await sortBy(page, "Reported amount", label);
      await verifyBothPages(ascending);
      expect(fixture.requests.at(-1).args).toMatchObject({
        p_order_by: "amount",
        p_direction: direction,
      });
    }
    expect(fixture.countRequests.filter((entry) => entry.dataset === dataset)).toHaveLength(1);
  });
}
