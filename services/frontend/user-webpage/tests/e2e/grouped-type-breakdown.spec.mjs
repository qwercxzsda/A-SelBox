import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { summaryAmount, summaryBucket, summaryCards, typeBucket } from "./summary-fixtures.mjs";

const GROUPS = [
  "Sales and refunds",
  "Sponsored Products charge",
  "FBA fulfillment fees",
  "Referral fee",
  "Other",
];
const TYPES = [
  "Product sales",
  "Product refunds",
  "Net product sales",
  "Sponsored products charge",
  "FBA fulfillment fee",
  "Referral fee",
  "Unknown test type",
];

async function seedGroupedBreakdown(page) {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-03-15", "109.000000000000000001", {
      companyAmount: "97.000000000000000001",
      rowCount: 8,
      knownCompanyCount: 5,
    }),
    summaryBucket("2026-03-15", "42", { currency: "EUR" }),
  ];
  fixture.breakdownRows = [
    typeBucket("PRODUCT_REFUNDS", "-0.100000000000000001"),
    typeBucket("PRODUCT_SALES", "0.100000000000000002"),
    typeBucket("NET_PRODUCT_SALES", "5", {
      companyAmount: null,
      serviceFee: null,
      rowCount: 2,
      knownCompanyCount: 0,
    }),
    typeBucket("SPONSORED_PRODUCTS_CHARGE", "-2"),
    typeBucket("FBA_FULFILLMENT_FEE", "-1"),
    typeBucket("REFERRAL_FEE", "100"),
    typeBucket("UNKNOWN_TEST_TYPE", "7", {
      companyAmount: null,
      serviceFee: null,
      knownCompanyCount: 0,
    }),
    typeBucket("PRODUCT_SALES", "42", { currency: "EUR" }),
  ];
  return fixture;
}

for (const width of [1280, 320, 390]) {
  test(`collapsed type groups at ${width}px use fixed order and preserve exact totals when expanded`, async ({
    page,
  }, testInfo) => {
    const mobile = width < 720;
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await seedGroupedBreakdown(page);
    await signIn(page);
    await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
    const buttons = dialog.getByRole("button", { name: / details$/ });
    await expect(buttons).toHaveCount(GROUPS.length);
    expect(
      await buttons.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      ),
    ).toEqual(GROUPS.map((name) => `${name} details`));
    for (const button of await buttons.all())
      await expect(button).toHaveAttribute("aria-expanded", "false");
    const childRole = mobile ? "article" : "row";
    const children = dialog.getByRole(childRole, { name: / amounts$/ });
    await expect(children).toHaveCount(0);
    const total = dialog.getByRole("region", { name: "Breakdown total", exact: true });
    await expect(summaryAmount(total, "Reported amount")).toHaveText("109.000000000000000001 USD");
    await expect(summaryAmount(total, "Known company amount")).toHaveText(
      "97.000000000000000001 USD",
    );
    await expect(total).toContainText("8 records across 7 types");
    await expect(total).toContainText("3 transactions have uncalculated amounts.");
    await testInfo.attach(`grouped-breakdown-collapsed-${width}px`, {
      body: await page.screenshot({ animations: "disabled", fullPage: true }),
      contentType: "image/png",
    });

    const salesButton = dialog.getByRole("button", {
      name: "Sales and refunds details",
      exact: true,
    });
    await salesButton.focus();
    await salesButton.press("Enter");
    await expect(salesButton).toHaveAttribute("aria-expanded", "true");
    await expect(
      dialog.getByRole(childRole, { name: "Product sales amounts", exact: true }),
    ).toBeVisible();
    for (const group of GROUPS.slice(1, -1)) {
      await dialog.getByRole("button", { name: `${group} details`, exact: true }).click();
    }
    const otherButton = dialog.getByRole("button", { name: "Other details", exact: true });
    await otherButton.focus();
    await otherButton.press("Space");
    await expect(otherButton).toHaveAttribute("aria-expanded", "true");
    await expect(children).toHaveCount(TYPES.length);
    expect(
      await children.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      ),
    ).toEqual(TYPES.map((name) => `${name} amounts`));
    for (const type of TYPES) {
      await expect(
        dialog.getByRole(childRole, { name: `${type} amounts`, exact: true }),
      ).toHaveCount(1);
    }

    const sales = dialog.getByRole("region", { name: "Sales and refunds subtotal", exact: true });
    await expect(summaryAmount(sales, "Reported amount")).toHaveText("5.000000000000000001 USD");
    await expect(summaryAmount(sales, "Known company amount")).toHaveText(
      "0.000000000000000001 USD",
    );
    await expect(sales).toContainText("2 uncalculated");
    const referral = dialog.getByRole("region", { name: "Referral fee subtotal", exact: true });
    await expect(summaryAmount(referral, "Company amount")).toHaveText("100 USD");
    const unknown = dialog.getByRole("region", { name: "Other subtotal", exact: true });
    await expect(summaryAmount(unknown, "Known company amount")).toHaveText("—");
    await expect(summaryAmount(total, "Reported amount")).toHaveText("109.000000000000000001 USD");
    await expect(summaryAmount(total, "Known company amount")).toHaveText(
      "97.000000000000000001 USD",
    );
    await expect(total).toContainText("8 records across 7 types");
    expect(fixture.breakdownRequests).toHaveLength(1);
    if (mobile) {
      const bounds = await children.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        }),
      );
      for (const box of bounds) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(box.scrollWidth).toBeLessThanOrEqual(box.width + 1);
      }
    }
    await salesButton.scrollIntoViewIfNeeded();
    await testInfo.attach(`grouped-breakdown-expanded-${width}px`, {
      body: await page.screenshot({ animations: "disabled", fullPage: true }),
      contentType: "image/png",
    });
    await salesButton.click();
    await expect(salesButton).toHaveAttribute("aria-expanded", "false");
    await expect(
      dialog.getByRole(childRole, { name: "Product sales amounts", exact: true }),
    ).toHaveCount(0);
    await expect(summaryAmount(total, "Known company amount")).toHaveText(
      "97.000000000000000001 USD",
    );
    await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
    await summaryCards(page).summaries.getByLabel("Currency", { exact: true }).selectOption("EUR");
    await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
    await expect(buttons).toHaveCount(1);
    await expect(salesButton).toHaveAttribute("aria-expanded", "false");
    await salesButton.click();
    await expect(children).toHaveCount(1);
    await expect(summaryAmount(total, "Company amount")).toHaveText("42 EUR");
    await expect(total).toContainText("1 record across 1 type");
    await expect(dialog).not.toContainText("USD");
    expect(fixture.breakdownRequests.map(({ params }) => params.get("currency"))).toEqual([
      "eq.USD",
      "eq.EUR",
    ]);
  });
}
