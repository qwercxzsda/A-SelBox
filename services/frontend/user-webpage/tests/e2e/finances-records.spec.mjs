import { expect, test } from "@playwright/test";
import { financesRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

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
      category: "DATA_KIOSK",
    },
    {
      ...financesRow("TRANSFER", "90"),
      transaction_type: "Transfer",
      transaction_status: "RELEASED",
      component_type: "BANK_TRANSFERS",
      category: "SELBOX",
      activity_eligible: "false",
    },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  for (const suffix of ["ORIGINAL", "DIRECT-FEE"])
    await expect(rowWithSku(page, `FINANCES-${suffix}`)).toContainText("Included");
  for (const suffix of ["RELEASE", "TRANSFER"])
    await expect(rowWithSku(page, `FINANCES-${suffix}`)).toContainText("Exclusive");
  await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);

  await rowWithSku(page, "FINANCES-RELEASE").click();
  let drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("This record is exclusive of activity totals.");
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
  drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("amazon-original-A");
  await page.screenshot({
    path: testInfo.outputPath("finances-release-details.png"),
    animations: "disabled",
  });
});
