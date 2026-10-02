import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview } from "./fixtures.mjs";

const reportId = "0198b50b-701a-7000-8000-000000000002";
const companyId = "0198b50b-701a-7000-8000-000000000001";

for (const width of [1440, 1920]) {
  test(`payout amount sections share desktop tables and disclosures at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    fixture.payoutRows = [
      {
        id: reportId,
        company_id: companyId,
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        created_at: "2026-09-27",
        currency: "USD",
        source_amount: "100",
        fee_amount: "-5",
        company_amount: "95",
        reconciliation_count: "51",
      },
    ];
    const record = {
      report_id: reportId,
      activity_date: "2026-06-12",
      sku: "SKU-ONE",
      marketplace_name: "Amazon.com",
      source: "SETTLEMENT",
      component_type: "PRODUCT_SALES",
      quantity: "1",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    };
    fixture.payoutComponents = [{ ...record, id: "amount", authoritative: "true" }];
    fixture.payoutMarketplaceTotals = [
      {
        report_id: reportId,
        marketplace_name: "Amazon.com",
        source_amount: "100",
        fee_amount: "-5",
        company_amount: "95",
      },
    ];
    await signIn(page);
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    await page.getByRole("cell", { name: "95 USD", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
    const records = drawer.getByRole("table", { name: "Amount records", exact: true });
    await expect(records).toBeVisible();
    await drawer.getByRole("button", { name: "Sales and refunds details", exact: true }).click();
    const typeTable = drawer.getByRole("table", { name: "Transaction type amounts", exact: true });
    expect(
      fixture.events.some(({ endpoint }) => endpoint.endsWith("/payout_report_marketplace_totals")),
    ).toBe(false);
    expect(
      fixture.events.some(({ endpoint }) => endpoint.endsWith("/payout_report_reconciliation")),
    ).toBe(false);
    for (const label of ["Marketplace breakdown"]) {
      const toggle = drawer.getByRole("button", { name: label, exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(
        await toggle.evaluate((element) =>
          Boolean(element.ownerDocument.getElementById(element.getAttribute("aria-controls"))),
        ),
      ).toBe(true);
      await toggle.focus();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(drawer.getByRole("heading", { name: label, exact: true })).toHaveCount(1);
    }
    const marketplace = drawer.getByRole("table", {
      name: "Payout marketplace breakdown",
      exact: true,
    });
    await expect(
      marketplace.getByRole("columnheader", { name: "Reported amount (USD)", exact: true }),
    ).toBeVisible();
    await expect(
      marketplace.getByRole("columnheader", { name: "Company amount (USD)", exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Saved source details", exact: true }),
    ).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Reconciliation", exact: true })).toHaveCount(
      0,
    );
    const styles = [];
    for (const table of [records, marketplace, typeTable]) {
      styles.push(
        await table.evaluate((element) => {
          const styleWindow = element.ownerDocument.defaultView;
          const header = styleWindow.getComputedStyle(element.querySelector("th"));
          const cell = styleWindow.getComputedStyle(element.querySelector("td"));
          const number = styleWindow.getComputedStyle(
            element.querySelector('td[data-kind="number"]') ?? element.querySelector("td"),
          );
          return {
            font: cell.fontSize,
            padding: cell.padding,
            header: header.backgroundColor,
            align: number.textAlign,
            tableWidth: element.scrollWidth,
            wrapperWidth: element.parentElement.clientWidth,
          };
        }),
      );
    }
    for (const style of styles) {
      expect(style.font).toBe(styles[0].font);
      expect(style.padding).toBe(styles[0].padding);
      expect(style.header).toBe(styles[0].header);
      expect(style.align).toBe("right");
      expect(style.tableWidth).toBeLessThanOrEqual(style.wrapperWidth + 1);
    }
    await captureResponsiveReview(page, testInfo, "consistent-payout-sections");
    expect(errors).toEqual([]);
  });
}
