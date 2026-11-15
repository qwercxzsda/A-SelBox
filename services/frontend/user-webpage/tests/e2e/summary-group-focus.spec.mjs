import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";

for (const width of [1280, 390]) {
  test(`restored trend breakdown expands and focuses its group after delayed totals at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [summaryBucket("2026-07-01", "1"), summaryBucket("2026-06-30", "85")];
    fixture.breakdownRows = [
      typeBucket("PRODUCT_SALES", "100"),
      typeBucket("REFERRAL_FEES", "-5"),
      typeBucket("FBA_STORAGE_FEE", "-10"),
    ];
    await signIn(page);
    await page
      .getByRole("button", { name: "View Last month for Amazon.com in USD by type", exact: false })
      .click();
    const drawer = page.getByRole("dialog", { name: "Transaction totals", exact: true });
    await expect(
      drawer.getByRole("button", { name: "Storage & inventory details", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((name) => name.endsWith(":summary-breakdown"));
      const selection = JSON.parse(sessionStorage.getItem(key));
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...selection, title: "Weekly trends", focusedGroup: "inventory" }),
      );
    });
    const responseReady = deferred();
    fixture.beforeBreakdown = () => responseReady.promise;
    await page.reload();
    await expect(drawer.getByRole("status", { name: "Loading amounts by type" })).toBeVisible();
    responseReady.resolve();
    const inventory = drawer.getByRole("button", {
      name: "Storage & inventory details",
      exact: true,
    });
    await expect(inventory).toHaveAttribute("aria-expanded", "true");
    await expect(inventory).toBeFocused();
    await expect(inventory).toBeInViewport();
    await expect(
      drawer.getByRole("button", { name: "Sales & refunds details", exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Selling fees details", exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("region", { name: "Breakdown total", exact: true }),
    ).toContainText("85.00 USD");
    expect(fixture.breakdownRequests.at(-1).args.p_types).toEqual([]);
    await inventory.click();
    await expect(inventory).toHaveAttribute("aria-expanded", "false");
    await drawer.getByRole("button", { name: "Sales & refunds details", exact: true }).click();
    await expect(
      drawer.getByRole("button", { name: "Sales & refunds details", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  });
}
