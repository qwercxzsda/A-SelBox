import { payoutHistoryRows } from "./payout-history-actions.mjs";
import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { selectColumnOptions } from "./table-actions.mjs";

const COMPANY = "0198b50b-701a-7000-8000-000000000001";
const OTHER_COMPANY = "0198b50b-701a-7000-8000-000000000002";
const reportId = (number) => `0198b50b-701a-7000-8001-${String(number).padStart(12, "0")}`;

function report(number, marketplace, amount, overrides = {}) {
  return {
    id: reportId(number),
    company_id: COMPANY,
    start_date: "2026-06-01",
    end_date: "2026-06-30",
    marketplace_name: marketplace,
    currency: "EUR",
    source_amount: amount,
    fee_amount: "0",
    company_amount: amount,
    created_at: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

async function setup(page, role = "administrator") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = "Market Company";
  fixture.payoutRows = [
    report(1, "Amazon.de", "100"),
    report(2, "Amazon.fr", "200"),
    report(3, "Amazon.de", "50", { currency: "USD" }),
    report(4, "Amazon.de", "90", { created_at: "2026-09-20T00:00:00Z" }),
    report(5, "Amazon.fr", "190", { created_at: "2026-09-20T00:00:00Z" }),
    report(8, "Amazon.de", "999", { company_id: OTHER_COMPANY }),
    report(9, null, "5"),
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  return fixture;
}

for (const [role, width] of [
  ["administrator", 1440],
  ["member", 390],
]) {
  test(`${role} browses separate same-currency marketplaces and exact market versions at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, role);
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.getByRole("cell", { name: "100.00 EUR", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "200.00 EUR", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "50.00 USD", exact: true })).toHaveCount(2);
    if (role === "member") await expect(table).not.toContainText("999.00 EUR");
    await selectColumnOptions(page, "Marketplace", ["Amazon.de"]);
    await expect(table).not.toContainText("200.00 EUR");
    await expect(
      page.getByText("Readiness covers all marketplaces for each company and month.", {
        exact: true,
      }),
    ).toHaveCount(0);
    const scope = "Market Company · June 2026 · Amazon.de · EUR";
    await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
    await expect(payoutHistoryRows(page, scope)).toHaveCount(1);
    await expect(payoutHistoryRows(page, scope)).not.toContainText("190.00 EUR");
    await payoutHistoryRows(page, scope).click();
    const drawer = page.getByRole("dialog", { name: "Payout report details", exact: true });
    await expect(drawer.locator(".detail-drawer-context")).toContainText("Amazon.de · EUR");
    await expect(drawer).toContainText("90.00");
    await expect(page).toHaveURL(/reportMarketplace=Amazon.de/);
    await page.reload();
    await expect(drawer).toContainText("90.00");
    const version = fixture.requests.find(({ params }) => params.get("id") === `eq.${reportId(4)}`);
    expect(version.params.get("marketplace_name")).toBe("eq.Amazon.de");
    await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
    await expect(table).not.toContainText("200.00 EUR");
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`market-payouts-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
