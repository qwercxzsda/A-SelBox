import { expect, test } from "@playwright/test";
import { AMOUNT_ORDER_LIMIT_MESSAGE } from "../../src/api/amount-ordering.ts";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn, sortBy } from "./table-actions.mjs";

async function prepare(page, dataset, tab) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  const rows = Array.from({ length: 30 }, (_, index) => ({
    ...(dataset === "live"
      ? liveRow("CAP", index + 1)
      : dataset === "settlement"
        ? settlementRow(index + 1)
        : kioskRow(index + 1, "10")),
    sku: `CAP-${String(index).padStart(3, "0")}`,
  }));
  if (dataset === "live") fixture.liveRows = rows;
  else if (dataset === "settlement") fixture.settlementRows = rows;
  else fixture.kioskRows = rows;
  return {
    fixture,
    open: async () => {
      await signIn(page);
      if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(
        page.getByRole("table", { name: "Financial records", exact: true }).getByRole("row"),
      ).toHaveCount(26);
    },
  };
}

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["settlement", "Settlements"],
  ["data_kiosk", "Data Kiosk"],
]) {
  test(`${tab} explains disabled amount ordering above the known limit and enables it after narrowing`, async ({
    page,
  }) => {
    const { fixture, open } = await prepare(page, dataset, tab);
    fixture.countTotalForRequest = ({ dataset: requested, args, count }) =>
      requested === dataset && !args.p_search ? 10_001 : count;
    await open();
    await expect(page.getByRole("form", { name: "Page 1 of 401", exact: true })).toBeVisible();
    const before = fixture.requests.length;
    const menu = await openColumn(page, "Reported amount");
    await expect(menu.getByRole("button", { name: "Highest first", exact: true })).toBeDisabled();
    await expect(menu.getByRole("button", { name: "Lowest first", exact: true })).toBeDisabled();
    await expect(menu).toContainText("10,001 matching rows");
    await expect(menu).toContainText("10,000 or fewer");
    expect(fixture.requests).toHaveLength(before);
    await menu.getByRole("button", { name: "Close options", exact: true }).click();
    await page.getByLabel("Search", { exact: true }).fill("CAP-000");
    await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
    await sortBy(page, "Reported amount", "Highest first");
    await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("amount");
    expect(fixture.requests.at(-1).args.p_search).toBe("CAP-000");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test(`${tab} handles a server cap before the count is known and offers date recovery`, async ({
    page,
  }) => {
    const { fixture, open } = await prepare(page, dataset, tab);
    const release = deferred();
    fixture.beforeCount = async (entry) => {
      if (entry.dataset === dataset) await release.promise;
    };
    fixture.amountOrderCountForRequest = (entry) => (entry.dataset === dataset ? 10_001 : 30);
    try {
      await open();
      await sortBy(page, "Reported amount", "Highest first");
      const alert = page.getByRole("alert");
      await expect(alert).toContainText(AMOUNT_ORDER_LIMIT_MESSAGE);
      await expect(alert).not.toContainText("HTTP");
      await expect(alert.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
      await expect(page.getByText("No matching records", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Search", { exact: true })).toBeEnabled();
      const menu = await openColumn(page, "Date");
      await expect(menu.getByLabel("From date", { exact: true })).toBeEnabled();
      await menu.getByRole("button", { name: "Close options", exact: true }).click();
      await alert.getByRole("button", { name: "Order by date", exact: true }).click();
      await expect(alert).toHaveCount(0);
      await expect(
        page.getByRole("table", { name: "Financial records", exact: true }).getByRole("row"),
      ).toHaveCount(26);
      await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    } finally {
      release.resolve();
    }
  });
}

test("exactly 10,000 matching rows can be ordered by amount", async ({ page }) => {
  const { fixture, open } = await prepare(page, "live", "Transactions");
  fixture.countTotalForRequest = () => 10_000;
  fixture.amountOrderCountForRequest = () => 10_000;
  await open();
  await expect(page.getByRole("form", { name: "Page 1 of 400", exact: true })).toBeVisible();
  await sortBy(page, "Reported amount", "Lowest first");
  await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("amount");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
