import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, financesRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { item, feeRow, feeDetails } from "./sku-configuration-fixtures.mjs";
import { companyRow, companyDrawer, closeCompanyDetails } from "./company-actions.mjs";

const financialTable = (page) =>
  page.getByRole("table", { name: "Financial records", exact: true });

async function checkTable(table) {
  await expect(table).toBeVisible();
  const header = table.locator("thead th").first();
  await expect(header).toHaveCSS("font-size", "12px");
  await expect(header).toHaveCSS("font-weight", "600");
  await expect(header).toHaveCSS("text-transform", "none");
  await expect(header).toHaveCSS("background-color", "rgb(241, 245, 248)");
  await expect(header).toHaveCSS("padding-top", "10px");
  await expect(header).toHaveCSS("padding-left", "12px");
  await expect(table.locator("tbody td").first()).toHaveCSS("font-size", "13px");
  await expect(table.locator("tbody td").first()).toHaveCSS("padding-top", "8px");
  await expect(table.locator("tbody td").first()).toHaveCSS("padding-left", "12px");
}

async function checkMetadata(drawer) {
  const disclosure = drawer.getByRole("button", { name: "Additional details", exact: true });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(
    drawer.getByText("Saved identifiers and metadata for this record.", { exact: true }),
  ).toBeVisible();
  const table = drawer.locator(".record-metadata-table");
  await checkTable(table);
  await expect(table.getByRole("columnheader")).toHaveText(["Field", "Value"]);
  await expect(table).toHaveCSS("table-layout", "fixed");
  await disclosure.click();
  await expect(table).toHaveCount(0);
}

async function checkDrawer(drawer) {
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".mantine-Drawer-title")).toHaveCSS("font-size", "16px");
  await expect(drawer.locator(".mantine-Drawer-title")).toHaveCSS("font-weight", "600");
}

async function disclosureStyle(button) {
  return button.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    const icon = element.querySelector("svg");
    const iconStyle = globalThis.getComputedStyle(icon);
    return Object.fromEntries([
      ...[
        "fontSize",
        "fontWeight",
        "lineHeight",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderRadius",
        "height",
        "marginLeft",
      ].map((key) => [key, style[key]]),
      ["iconWidth", iconStyle.width],
      ["iconHeight", iconStyle.height],
      ["iconTransform", iconStyle.transform],
    ]);
  });
}

async function checkDisclosure(button, opened) {
  await expect(button).toHaveAttribute("aria-expanded", String(opened));
  await expect(button.locator("svg")).toHaveCSS("width", "12px");
  await expect(button.locator("svg")).toHaveCSS("height", "12px");
  await expect
    .poll(() =>
      button.locator("svg").evaluate((icon) => {
        const transform = globalThis.getComputedStyle(icon).transform;
        const matrix =
          transform === "none" ? new globalThis.DOMMatrix() : new globalThis.DOMMatrix(transform);
        return [Math.round(matrix.a * 1000000), Math.round(matrix.b * 1000000)];
      }),
    )
    .toEqual(opened ? [0, 1000000] : [1000000, 0]);
}

async function setupDesignWorkspace(page, role) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.roles["member-a"] = role;
  fixture.liveRows = [
    {
      ...liveRow("DESIGN", 1, REVIEW_COMPANY),
      component_type: "TAX_WITHHELD",
    },
  ];
  fixture.financesRows = [financesRow(1)];
  fixture.kioskRows = [kioskRow(1, "12.5")];
  fixture.skuConfigurationItems = [item("DESIGN-SKU", { company_id: REVIEW_COMPANY })];
  await mockInventory(page, [
    inventoryRow("DESIGN-SKU", {
      company_id: REVIEW_COMPANY,
      available: "0",
      health_status: "Out of stock",
      recommended_action: "GoToRestock",
    }),
  ]);
  await signIn(page);
}

for (const [role, width] of [
  ["administrator", 1440],
  ["administrator", 390],
  ["member", 1440],
  ["member", 390],
]) {
  test(`${role} tables and drawers share typography and spacing at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
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
    if (role === "administrator") await checkMetadata(rowDetail);
    await rowDetail.getByRole("button", { name: "Close row details", exact: true }).click();

    if (role === "administrator") {
      for (const name of ["Finances", "Data Kiosk", "User access"]) {
        await openTab(name);
        await checkTable(
          name === "User access"
            ? page.getByRole("table", { name: "User accounts", exact: true })
            : financialTable(page),
        );
        await screenshot(name.toLowerCase().replaceAll(" ", "-"));
        const table =
          name === "User access"
            ? page.getByRole("table", { name: "User accounts", exact: true })
            : financialTable(page);
        await table.locator("tbody tr.inspectable-row").first().press("Enter");
        const details =
          name === "User access"
            ? page.getByRole("dialog", { name: "Company membership", exact: true })
            : rowDetail;
        await checkDrawer(details);
        await checkMetadata(details);
        await screenshot(`${name.toLowerCase().replaceAll(" ", "-")}-details`);
        await details
          .getByRole("button", {
            name: name === "User access" ? "Close membership details" : "Close row details",
            exact: true,
          })
          .click();
      }
    }

    await openTab("Current fees");
    const fees = page.getByRole("table", { name: "Current fee configurations", exact: true });
    await checkTable(fees);
    await expect(fees.getByRole("columnheader", { name: "Actions", exact: true })).toHaveCount(0);
    const feeToggle = fees.getByRole("button", {
      name: /^(Show|Hide) fee periods for DESIGN-SKU$/,
    });
    await checkDisclosure(feeToggle, false);
    const collapsedDisclosure = await disclosureStyle(feeToggle);
    await feeToggle.press("Enter");
    await checkDisclosure(feeToggle, true);
    await expect(feeToggle).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const expandedDisclosure = await disclosureStyle(feeToggle);
    await checkTable(fees);
    await screenshot("fee-list");
    await feeRow(page, "DESIGN-SKU").click();
    await checkDrawer(feeDetails(page));
    await checkTable(
      page.getByRole("table", { name: "Marketplace fees for DESIGN-SKU", exact: true }),
    );
    await screenshot("fees");
    if (role === "administrator") {
      await checkMetadata(feeDetails(page));
      await page.getByRole("button", { name: "Edit DESIGN-SKU", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit DESIGN-SKU", exact: true });
      await checkDrawer(editor);
      await checkMetadata(editor);
      await expect(editor.getByRole("button", { name: "Keep draft", exact: true })).toHaveCSS(
        "border-radius",
        "6px",
      );
      await screenshot("fee-editor");
      await editor.getByRole("button", { name: "Close SKU editor", exact: true }).click();
    } else {
      await feeDetails(page)
        .getByRole("button", { name: "Close fee details", exact: true })
        .click();
    }

    if (role === "administrator") {
      await openTab("Companies");
      const companies = page.getByRole("table", { name: "Companies", exact: true });
      await checkTable(companies);
      await expect(
        companies.getByRole("columnheader", { name: "Actions", exact: true }),
      ).toHaveCount(0);
      await screenshot("company-list");
      await companyRow(page, "Review Company").click();
      await checkDrawer(companyDrawer(page));
      await screenshot("company-details");
      await checkMetadata(companyDrawer(page));
      await closeCompanyDetails(page);
    }

    await openTab("Inventory");
    await checkTable(page.locator(".inventory-table"));
    await screenshot("inventory");
    await page.locator(".inventory-table tbody tr").first().press("Enter");
    const inventory = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await checkDrawer(inventory);
    await checkMetadata(inventory);
    await screenshot("inventory-details");
    await inventory.getByRole("button", { name: "Close inventory details", exact: true }).click();

    await openTab("Payout reports");
    await checkTable(financialTable(page));
    const versionToggle = financialTable(page)
      .getByRole("button", { name: /^(Show|Hide) versions for / })
      .first();
    await checkDisclosure(versionToggle, false);
    expect(await disclosureStyle(versionToggle)).toEqual(collapsedDisclosure);
    await versionToggle.press("Space");
    await checkDisclosure(versionToggle, true);
    await expect(versionToggle).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await disclosureStyle(versionToggle)).toEqual(expandedDisclosure);
    await versionToggle.press("Enter");
    await checkDisclosure(versionToggle, false);
    await screenshot("payouts");
    await financialTable(page).locator("tbody tr.inspectable-row").first().click();
    await checkDrawer(rowDetail);
    await checkTable(rowDetail.getByRole("table", { name: "Amount records", exact: true }));
    await screenshot("payout-details");
    if (role === "administrator") await checkMetadata(rowDetail);
    await rowDetail.getByRole("button", { name: "Close row details", exact: true }).click();

    if (role === "administrator") {
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
      if (width > 720)
        await checkTable(
          review.getByRole("table", { name: "Financial review totals", exact: true }),
        );
      else await expect(review.locator(".monthly-review-totals-mobile")).toBeVisible();
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
      await checkMetadata(support);
    } else {
      await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
    }
  });
}
