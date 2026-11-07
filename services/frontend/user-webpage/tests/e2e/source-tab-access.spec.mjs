import { expect, test } from "@playwright/test";
import { financesRow, kioskRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

for (const dataset of ["finances", "data_kiosk"]) {
  test(`member cannot open the ${dataset} full-source tab through a URL`, async ({ page }) => {
    const rawRequests = [];
    page.on("request", (request) => {
      if (/\/source_transaction_(page|count)$/.test(new URL(request.url()).pathname))
        rawRequests.push(request.url());
    });
    await mockSupabase(page);
    await signIn(page);
    await page.goto(`/?tab=${dataset}`);
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    for (const name of ["Finances", "Data Kiosk"])
      await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
    expect(rawRequests).toEqual([]);
  });
}

test("administrator source tabs retain comparison and historical rows", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [
    {
      ...financesRow(1, "-5"),
      sku: "FINANCE-CONTROL",
      category: "DATA_KIOSK",
      component_type: "STORAGE_FEES",
      is_current: "false",
      activity_eligible: "false",
    },
  ];
  fixture.kioskRows = [
    {
      ...kioskRow(1, "98"),
      sku: "KIOSK-COMPARISON",
      category: "FINANCES",
      component_type: "NET_PRODUCT_SALES",
      is_current: "false",
    },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(rowWithSku(page, "FINANCE-CONTROL")).toBeVisible();
  await page.getByRole("tab", { name: "Data Kiosk", exact: true }).click();
  await expect(rowWithSku(page, "KIOSK-COMPARISON")).toBeVisible();
});
