import { expect, test } from "@playwright/test";
import { financesRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { openRawData } from "./raw-data-fixtures.mjs";

for (const location of ["tab=finances", "tab=raw-data", "tab=raw-data&raw=finances"]) {
  test(`member cannot open Finances through ${location}`, async ({ page }) => {
    const rawRequests = [];
    page.on("request", (request) => {
      if (/\/(source_transaction_(page|count)|current_\w+)$/.test(new URL(request.url()).pathname))
        rawRequests.push(request.url());
    });
    await mockSupabase(page);
    await signIn(page);
    await page.goto(`/?${location}`);
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    for (const name of ["Raw data", "Finances"])
      await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
    expect(rawRequests).toEqual([]);
  });
}

test("administrator Finances retains historical charge rows", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [
    {
      ...financesRow(1, "-5"),
      sku: "FINANCE-CONTROL",
      route: "STORAGE",
      component_type: "STORAGE_FEES",
      is_current: "false",
      activity_eligible: "false",
    },
  ];
  await signIn(page);
  await openRawData(page);
  await expect(rowWithSku(page, "FINANCE-CONTROL")).toContainText("Earlier version");
});
