import { expect, test } from "@playwright/test";
import { financesRow, kioskRow, liveRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

for (const [dataset, tab] of [
  ["live", "Transactions"],
  ["finances", "Finances"],
  ["data_kiosk", "Data Kiosk"],
]) {
  test(`${tab} rounds money to two decimals including JPY while preserving quantities and source values`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    const examples = [
      ["0", "0.00 JPY"],
      ["-0.004", "0.00 JPY"],
      ["1.005", "1.01 JPY"],
      ["-1.005", "-1.01 JPY"],
      ["9007199254740993.995", "9,007,199,254,740,994.00 JPY"],
      ["1.005e+2", "100.50 JPY"],
      ["5e-3", "0.01 JPY"],
    ];
    const rows = examples.map(([amount], index) => ({
      ...(dataset === "live"
        ? { ...liveRow("MONEY", index), source_amount: amount }
        : dataset === "finances"
          ? financesRow(index, amount)
          : kioskRow(index, amount)),
      sku: `MONEY-${index}`,
      currency: "JPY",
      quantity: "1.23456789",
      fee_base: "123.456789",
      ...(dataset === "live" ? { fee_rate_percent: "5.123456" } : {}),
    }));
    if (dataset === "live") fixture.liveRows = rows;
    else if (dataset === "finances") fixture.financesRows = rows;
    else fixture.kioskRows = rows;
    await signIn(page);
    if (dataset !== "live") await page.getByRole("tab", { name: tab, exact: true }).click();
    for (const [index, [, displayed]] of examples.entries()) {
      const row = rowWithSku(page, `MONEY-${index}`);
      const column = dataset === "live" ? "source_amount" : "amount";
      const amount = row.locator(`[data-column="${column}"]`);
      await expect(
        dataset === "live" ? amount.locator(".stacked-cell-primary") : amount,
      ).toHaveText(displayed);
      if (dataset === "live") {
        await expect(amount.locator(".stacked-cell-secondary")).toHaveText("Quantity: 1.23456789");
        await expect(row.locator('[data-column="fee_amount"] .stacked-cell-secondary')).toHaveText(
          "Fee rate: 5.123456%",
        );
      } else await expect(row.locator('[data-column="quantity"]')).toHaveText("1.23456789");
    }
    await rowWithSku(page, "MONEY-2").click();
    const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
    await expect(drawer.getByText("1.01 JPY", { exact: true })).toBeVisible();
    if (dataset === "live") {
      await expect(drawer.locator(".field-label").filter({ hasText: /^Quantity$/ })).toHaveCount(1);
      await expect(drawer.locator(".field-label").filter({ hasText: /^Fee rate$/ })).toHaveCount(1);
    }
    await drawer.getByRole("button", { name: "Additional details", exact: true }).click();
    const metadata = drawer.getByRole("table", { name: "Additional record details", exact: true });
    if (dataset === "live") {
      await expect(metadata.getByRole("cell", { name: "quantity", exact: true })).toHaveCount(0);
      await expect(
        metadata.getByRole("cell", { name: "fee rate percent", exact: true }),
      ).toHaveCount(0);
    }
    const feeBase = metadata
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "fee base", exact: true }) });
    await expect(feeBase.getByRole("cell").last()).toHaveText("123.46");
    expect(rows.map((row) => row[dataset === "live" ? "source_amount" : "amount"])).toEqual(
      examples.map(([amount]) => amount),
    );
    expect(rows.map((row) => row.fee_base)).toEqual(examples.map(() => "123.456789"));
  });
}
