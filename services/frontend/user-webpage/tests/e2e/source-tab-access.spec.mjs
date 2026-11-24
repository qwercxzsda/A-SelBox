import { expect, test } from "@playwright/test";
import { financesRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

for (const dataset of ["finances"]) {
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
    for (const name of ["Finances"])
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
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(rowWithSku(page, "FINANCE-CONTROL")).toBeVisible();
});
