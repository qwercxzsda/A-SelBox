import { expect, test } from "@playwright/test";
import { financesRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { openRawData } from "./raw-data-fixtures.mjs";

test("Finances distinguishes activity from releases and retains transaction-version details", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [
    {
      ...financesRow("ORIGINAL", "100"),
      native_transaction_id: "amazon-original-A",
      release_transaction_id: "amazon-release-B",
      transaction_status: "DEFERRED_RELEASED",
    },
    {
      ...financesRow("RELEASE", "100"),
      native_transaction_id: "amazon-release-B",
      deferred_transaction_id: "amazon-original-A",
      transaction_status: "RELEASED",
      activity_eligible: "false",
    },
    {
      ...financesRow("DIRECT-FEE", "-10"),
      transaction_type: "ServiceFee",
      transaction_status: "RELEASED",
      component_type: "STORAGE_FEES",
      route: "STORAGE",
    },
    {
      ...financesRow("TRANSFER", "90"),
      transaction_type: "Transfer",
      transaction_status: "RELEASED",
      component_type: "BANK_TRANSFERS",
      route: "ACCOUNT",
      activity_eligible: "false",
    },
  ];
  await signIn(page);
  await openRawData(page);
  for (const suffix of ["ORIGINAL", "DIRECT-FEE"])
    await expect(rowWithSku(page, `FINANCES-${suffix}`)).toContainText("Included");
  for (const suffix of ["RELEASE", "TRANSFER"])
    await expect(rowWithSku(page, `FINANCES-${suffix}`)).toContainText("Excluded");
  await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);

  await rowWithSku(page, "FINANCES-RELEASE").click();
  let drawer = page.getByRole("dialog", { name: "Finances record details", exact: true });
  await expect(drawer).toContainText("Not counted as activity.");
  await drawer.getByRole("button", { name: "Additional details", exact: true }).click();
  const metadata = drawer.getByRole("table", { name: "Additional record details", exact: true });
  for (const [field, value] of [
    ["Version ID", "version-1"],
    ["Processing batch ID", "finances-batch-1"],
    ["Amazon transaction ID", "amazon-release-B"],
    ["Original transaction ID", "amazon-original-A"],
    ["Amazon transaction status", "RELEASED"],
    ["Account type", "STANDARD_ORDERS"],
    ["Source page", "1"],
    ["Source record", "1"],
  ]) {
    const row = metadata
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: field, exact: true }) });
    await expect(row).toContainText(value);
  }
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Finances record details", exact: true });
  await expect(drawer).toContainText("amazon-original-A");
  await page.screenshot({
    path: testInfo.outputPath("finances-release-details.png"),
    animations: "disabled",
  });
});

test("a Finances record names its SelBox group in SelBox's casing, by the group's label", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [
    { ...financesRow("ACCOUNT-FEE", "-39.99"), route: "SELBOX", selbox_group: "ACCOUNT_FEE" },
  ];
  await signIn(page);
  await openRawData(page);
  await rowWithSku(page, "FINANCES-ACCOUNT-FEE").click();
  const drawer = page.getByRole("dialog", { name: "Finances record details", exact: true });
  await drawer.getByRole("button", { name: "Additional details", exact: true }).click();
  const group = drawer
    .getByRole("table", { name: "Additional record details", exact: true })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "SelBox group", exact: true }) });
  await expect(group).toHaveText(/^SelBox group\s*Account fees$/);
  await expect(drawer).not.toContainText("Selbox");
  await expect(drawer).not.toContainText("ACCOUNT_FEE");
});
