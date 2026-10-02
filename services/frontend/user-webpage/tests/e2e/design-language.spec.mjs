import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { item } from "./sku-configuration-fixtures.mjs";

const financialTable = (page) =>
  page.getByRole("table", { name: "Financial records", exact: true });

async function checkTable(table) {
  await expect(table).toBeVisible();
  const header = table.locator("thead th").first();
  await expect(header).toHaveCSS("font-size", "12px");
  await expect(header).toHaveCSS("font-weight", "600");
  await expect(header).toHaveCSS("text-transform", "none");
  await expect(header).toHaveCSS("background-color", "rgb(241, 245, 248)");
  await expect(table.locator("tbody td").first()).toHaveCSS("font-size", "13px");
}

async function checkDrawer(drawer) {
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".mantine-Drawer-title")).toHaveCSS("font-size", "16px");
  await expect(drawer.locator(".mantine-Drawer-title")).toHaveCSS("font-weight", "600");
}

async function setupDesignWorkspace(page, role) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.roles["member-a"] = role;
  fixture.liveRows = [
    {
      ...liveRow("DESIGN", 1, REVIEW_COMPANY),
      component_type: "Order/ItemWithheldTax/MarketplaceFacilitatorVAT-Principal",
    },
  ];
  fixture.settlementRows = [settlementRow(1)];
  fixture.kioskRows = [kioskRow(1, "12.5")];
  fixture.skuConfigurationItems = [item("DESIGN-SKU", { company_id: REVIEW_COMPANY })];
  await mockInventory(page, [
    inventoryRow("DESIGN-SKU", {
      company_id: REVIEW_COMPANY,
      available: "0",
      health_status: "Out of stock",
      recommended_action: "Restock",
    }),
  ]);
  await signIn(page);
}

for (const role of ["operator", "company_member"]) {
  test(`${role} tables and drawers share typography while retaining each tab's workflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setupDesignWorkspace(page, role);
    const screenshot = async (label) => {
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${role}-${label}.png`),
        animations: "disabled",
      });
    };
    const openTab = async (name) => {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.evaluate(() => globalThis.scrollTo(0, 0));
    };

    await checkTable(financialTable(page));
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCSS(
      "border-radius",
      "6px",
    );
    await screenshot("transactions");
    await financialTable(page).locator("tbody tr").first().click();
    const rowDetail = page.getByRole("dialog", { name: "Selected row details", exact: true });
    await checkDrawer(rowDetail);
    await screenshot("transaction-details");
    await rowDetail.getByRole("button", { name: "Close row details", exact: true }).click();

    if (role === "operator") {
      for (const name of ["Settlements", "Data Kiosk", "User access"]) {
        await openTab(name);
        await checkTable(financialTable(page));
        await screenshot(name.toLowerCase().replaceAll(" ", "-"));
      }
    }

    await openTab("Current fees");
    await page
      .getByRole("button", { name: "Show marketplace fees for DESIGN-SKU", exact: true })
      .click();
    await checkTable(
      page.getByRole("table", { name: "Marketplace fees for DESIGN-SKU", exact: true }),
    );
    await screenshot("fees");
    if (role === "operator") {
      await page.getByRole("button", { name: "Edit DESIGN-SKU", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit DESIGN-SKU", exact: true });
      await checkDrawer(editor);
      await expect(editor.getByRole("button", { name: "Keep draft", exact: true })).toHaveCSS(
        "border-radius",
        "6px",
      );
      await screenshot("fee-editor");
      await editor.getByRole("button", { name: "Close SKU editor", exact: true }).click();
    }

    await openTab("Inventory");
    await checkTable(page.locator(".inventory-table"));
    await screenshot("inventory");

    await openTab("Payout reports");
    await checkTable(financialTable(page));
    await screenshot("payouts");
    await financialTable(page).locator("tbody tr.inspectable-row").first().click();
    await checkDrawer(rowDetail);
    await checkTable(rowDetail.getByRole("table", { name: "Amount records", exact: true }));
    await screenshot("payout-details");
    await rowDetail.getByRole("button", { name: "Close row details", exact: true }).click();

    if (role === "operator") {
      await openTab("Financial review");
      const monthly = page.getByRole("table", {
        name: "Monthly financial review",
        exact: true,
      });
      await checkTable(monthly);
      await screenshot("monthly-review");
      await monthly.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
      await checkDrawer(review);
      await checkTable(
        review.getByRole("table", { name: "Financial review by currency", exact: true }),
      );
      await screenshot("monthly-details");
      await review
        .getByRole("button", { name: "Close monthly financial review", exact: true })
        .click();
      await monthly.getByRole("button", { name: "Open review for June 2026", exact: true }).click();
      await review.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
      const snapshots = review.getByRole("table", { name: "Financial records", exact: true });
      await checkTable(snapshots);
      await snapshots.locator("tbody tr.inspectable-row").first().click();
      const support = page.getByRole("dialog", { name: "Saved source details", exact: true });
      await checkDrawer(support);
      await checkTable(
        support.getByRole("table", { name: "Supporting payout records", exact: true }),
      );
      await screenshot("supporting-details");
    } else {
      await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
    }
  });
}
