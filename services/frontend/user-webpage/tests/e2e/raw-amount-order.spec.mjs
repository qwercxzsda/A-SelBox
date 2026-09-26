import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { sortBy } from "./table-actions.mjs";

for (const [dataset, tab, dateColumn, amountColumn] of [
  ["live", "Transactions", "activity_date", "source_amount"],
  ["settlement", "Settlements", "posted_date", "amount"],
  ["data_kiosk", "Data Kiosk", "activity_date", "amount"],
]) {
  test(`${tab} sorts signed reported amounts with page RPCs and preserves RPC ordering through search`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    const rows = Array.from({ length: 30 }, (_, index) => {
      const exactExtremes = {
        0: "-9007199254740993.000000000000000002",
        1: "-9007199254740993.000000000000000001",
        28: "9007199254740993.000000000000000001",
        29: "9007199254740993.000000000000000002",
      };
      const amount = exactExtremes[index] ?? String(index - 15);
      const row =
        dataset === "live"
          ? liveRow("RAW", index + 1)
          : dataset === "settlement"
            ? settlementRow(index + 1, amount)
            : kioskRow(index + 1, amount);
      return {
        ...row,
        sku: `RAW-${String(index).padStart(2, "0")}`,
        [dateColumn]: "2026-09-01",
        [amountColumn]: amount,
        // Deliberately reverse the derived amounts to detect the wrong control/order.
        ...(dataset === "live" ? { company_amount: String(100 - index) } : {}),
      };
    });
    if (dataset === "live") fixture.liveRows = rows;
    else if (dataset === "settlement") fixture.settlementRows = rows;
    else fixture.kioskRows = rows;
    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    const firstRow = table.getByRole("row").nth(1);
    await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
    expect(fixture.requests.at(-1).args).toMatchObject({ p_order_by: "date", p_direction: "desc" });
    const countRequests = () =>
      fixture.countRequests.filter((entry) => entry.dataset === dataset).length;
    const initialCounts = countRequests();
    for (const [ordering, direction, sku] of [
      ["Highest first", "desc", "RAW-29"],
      ["Lowest first", "asc", "RAW-00"],
    ]) {
      await sortBy(page, "Reported amount", ordering);
      await expect(firstRow.getByRole("cell", { name: sku, exact: true })).toBeVisible();
      expect(fixture.requests.at(-1).transport).toBe("rpc");
      expect(fixture.requests.at(-1).args).toMatchObject({
        p_order_by: "amount",
        p_direction: direction,
        p_offset: 0,
        p_include_count: false,
      });
      expect(countRequests()).toBe(initialCounts);
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
    expect(fixture.requests.at(-1).args).toMatchObject({ p_order_by: "amount", p_offset: 25 });
    await page.getByLabel("Search", { exact: true }).fill("RAW-0");
    await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
    await expect(firstRow.getByRole("cell", { name: "RAW-00", exact: true })).toBeVisible();
    expect(fixture.requests.at(-1).transport).toBe("rpc");
    expect(fixture.requests.at(-1).params.get("order")).toMatch(
      new RegExp(`^${amountColumn}\\.asc\\.nullslast,`),
    );
    await page.getByLabel("Search", { exact: true }).clear();
    await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
    await sortBy(page, "Date", "Oldest first");
    await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("date");
    if (dataset === "live") {
      await expect(
        table
          .getByRole("columnheader", { name: "Company amount", exact: true })
          .getByRole("button"),
      ).toHaveCount(0);
    }
  });
}
