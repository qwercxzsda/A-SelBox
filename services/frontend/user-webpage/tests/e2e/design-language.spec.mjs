import { expect, test } from "@playwright/test";
import { liveRow, financesRow } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";

import { WORKSPACE_COMPANY, setupAdministratorWorkspace } from "./administrator-fixtures.mjs";
import { reviewDrawer, reviewMeasure, reviewOutcome } from "./financial-review-fixtures.mjs";
import {
  assignmentDrawer,
  assignmentTable,
  automaticVersion,
  referenceAssignment,
} from "./assignment-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { item, feeRow, feeDetails } from "./sku-configuration-fixtures.mjs";
import { companyRow, companyDrawer, closeCompanyDetails } from "./company-actions.mjs";
import { openWorkspaceTab } from "./raw-data-fixtures.mjs";

const REVIEW_JANUARY = `${String(new Date().getUTCFullYear())}-01`;
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
  await expect(header).toHaveCSS("vertical-align", "middle");
  const cell = table.locator("tbody td").first();
  await expect(cell).toHaveCSS("font-size", "13px");
  await expect(cell).toHaveCSS("padding-top", "8px");
  await expect(cell).toHaveCSS("padding-left", "12px");
  // One alignment in every list: values line up with the first line of stacked cells.
  const alignments = await table
    .locator(":scope > tbody > tr > :is(td, th)")
    .evaluateAll((cells) => [
      ...new Set(cells.map((element) => globalThis.getComputedStyle(element).verticalAlign)),
    ]);
  expect(alignments).toEqual(["top"]);
}

async function checkMetadata(drawer) {
  const disclosure = drawer.getByRole("button", { name: "Additional details", exact: true });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  // A collapsible title is a section title with a chevron: no underline and no accent color.
  await expect(disclosure).toHaveCSS("font-size", "16px");
  await expect(disclosure).toHaveCSS("font-weight", "600");
  await expect(disclosure).toHaveCSS("text-decoration-line", "none");
  await expect(disclosure).toHaveCSS("color", "rgb(36, 51, 66)");
  await expect(disclosure.locator("svg.ui-disclosure-chevron")).toHaveCount(1);
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const table = drawer.locator(".record-metadata-table");
  await checkTable(table);
  await expect(table.getByRole("columnheader")).toHaveText(["Field", "Value"]);
  await expect(table).toHaveCSS("table-layout", "fixed");
  await disclosure.click();
  await expect(table).toHaveCount(0);
}

const DRAWER_WIDTHS = { record: 720, wide: 1000, full: 1440 };

const closeButton = (drawer) => drawer.locator(".mantine-Drawer-header .ui-close-button");

/** Every drawer: one width token, "<Kind> details" plus "identity · scope", a derived close label. */
async function checkDrawer(
  drawer,
  { width, title, context, closeLabel = `Close ${title.toLowerCase()}` },
) {
  await expect(drawer).toBeVisible();
  const heading = drawer.locator(".mantine-Drawer-title");
  await expect(heading).toHaveCSS("font-size", "16px");
  await expect(heading).toHaveCSS("font-weight", "600");
  await expect(heading.locator(".detail-drawer-title")).toHaveText(title);
  await expect(heading.locator(".detail-drawer-context")).toHaveText(context);
  await expect(heading.locator(".detail-drawer-context")).toHaveCSS("font-size", "12px");
  await expect(closeButton(drawer)).toHaveAccessibleName(closeLabel);
  // The drawer and its overlay reach the window edge: no undimmed scrollbar gutter beside them.
  const windowWidth = await drawer.evaluate(() => globalThis.innerWidth);
  await expect
    .poll(() =>
      drawer.evaluate((element) => {
        const overlay = element
          .closest(".mantine-Drawer-root")
          .querySelector(".mantine-Drawer-overlay");
        const box = element.getBoundingClientRect();
        return [box.width, box.right, overlay.getBoundingClientRect().width].map(Math.round);
      }),
    )
    .toEqual([Math.min(DRAWER_WIDTHS[width], windowWidth), windowWidth, windowWidth]);
  // The heading is the only record title: no body heading repeats its identity.
  await expect(
    drawer
      .locator(".mantine-Drawer-body")
      .getByRole("heading", { name: context.split(" · ")[0], exact: true }),
  ).toHaveCount(0);
}

async function closeDrawer(drawer) {
  await closeButton(drawer).click();
  await expect(drawer).toBeHidden();
}

/** Header, title and body of a drawer or modal, for comparing the two dialog kinds. */
function dialogFrame(dialog) {
  return dialog.evaluate((element) => {
    const style = (selector, keys) => {
      const computed = globalThis.getComputedStyle(element.querySelector(selector));
      return Object.fromEntries(keys.map((key) => [key, computed[key]]));
    };
    const box = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    return {
      header: style("header", [
        ...box,
        "borderBottomWidth",
        "borderBottomColor",
        "backgroundColor",
      ]),
      title: style("header h2", ["fontSize", "fontWeight", "lineHeight", "color"]),
      body: style(".mantine-Drawer-body, .mantine-Modal-body", box),
    };
  });
}

/** The page behind a drawer or modal keeps its place while the page is locked. */
async function openKeepsPageStill(page, trigger, dialog) {
  const anchor = page.getByRole("button", { name: "Sign out", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const before = await anchor.boundingBox();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
  expect(await anchor.boundingBox()).toEqual(before);
  return dialog;
}

/** Status badges: sentence case, 12px/600, 20px tall, one tone palette. */
async function checkStatusBadge(badge, tone) {
  await expect(badge).toHaveAttribute("data-tone", tone);
  await expect(badge).toHaveCSS("font-size", "12px");
  await expect(badge).toHaveCSS("font-weight", "600");
  await expect(badge).toHaveCSS("text-transform", "none");
  await expect(badge).toHaveCSS("height", "20px");
  // Every badge keeps its whole label; a narrow column never shrinks it to an ellipsis.
  await expect(badge).toHaveCSS("min-width", "max-content");
  const label = badge.locator(".mantine-Badge-label");
  expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

async function checkTokens(page) {
  const tokens = await page.evaluate(() => {
    const style = globalThis.getComputedStyle(globalThis.document.documentElement);
    return Object.fromEntries(
      [
        "--ui-font-caption",
        "--ui-font-data",
        "--ui-font-section",
        "--ui-drawer-width-record",
        "--ui-drawer-width-wide",
        "--ui-drawer-width-full",
        "--mantine-font-size-xs",
        "--mantine-font-size-sm",
      ].map((name) => [name, style.getPropertyValue(name).trim()]),
    );
  });
  expect(tokens).toEqual({
    "--ui-font-caption": "12px",
    "--ui-font-data": "13px",
    "--ui-font-section": "16px",
    "--ui-drawer-width-record": "min(720px, 100vw)",
    "--ui-drawer-width-wide": "min(1000px, 100vw)",
    "--ui-drawer-width-full": "min(1440px, 100vw)",
    "--mantine-font-size-xs": "12px",
    "--mantine-font-size-sm": "13px",
  });
}

/** Phones scroll one row of workspace tabs instead of wrapping them. */
async function checkTabBar(page) {
  const list = page.getByRole("tablist", { name: "Workspace data", exact: true });
  await expect(list.getByRole("tab", { name: "Transactions", exact: true })).toBeVisible();
  const rows = await list
    .getByRole("tab")
    .evaluateAll(
      (tabs) => new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
    );
  expect(rows).toBe(1);
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
  await expect(button).toHaveCSS("text-decoration-line", "none");
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
  setupAdministratorWorkspace(fixture);
  fixture.roles["member-a"] = role;
  fixture.liveRows = [
    {
      ...liveRow("DESIGN", 1, WORKSPACE_COMPANY),
      component_type: "TAX_WITHHELD",
    },
  ];
  fixture.financesRows = [financesRow(1)];
  fixture.referenceAssignments = [
    referenceAssignment("design-campaign", {
      company_id: WORKSPACE_COMPANY,
      suggested_company_id: WORKSPACE_COMPANY,
      products: [{ sku: "DESIGN-SKU", asin: null, company_id: WORKSPACE_COMPANY }],
    }),
  ];
  fixture.assignmentVersions = [automaticVersion({ company_id: WORKSPACE_COMPANY })];
  // Financial review opens on the current year; January always belongs to it.
  fixture.reviewMonths = [
    reviewMeasure(REVIEW_JANUARY, "FINANCES", "-10.0002", "-1"),
    reviewMeasure(REVIEW_JANUARY, "COMPANY", "-10", "-1"),
    reviewMeasure(REVIEW_JANUARY, "DIFFERENCE", "-0.0002", "0", "ROUNDING"),
  ];
  fixture.reviewOutcomes = [
    reviewOutcome(1, {
      posted_date: `${REVIEW_JANUARY}-02`,
      reason: "ROUNDING",
      base_amount: "-0.0002",
      tax_amount: "0",
    }),
  ];

  fixture.skuConfigurationItems = [item("DESIGN-SKU", { company_id: WORKSPACE_COMPANY })];
  await mockInventory(page, [
    inventoryRow("DESIGN-SKU", {
      company_id: WORKSPACE_COMPANY,
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
      await openWorkspaceTab(page, name);
      await page.evaluate(() => globalThis.scrollTo(0, 0));
    };

    await checkTokens(page);
    await checkTabBar(page);
    await checkTable(financialTable(page));
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCSS(
      "border-radius",
      "6px",
    );
    await expect(page.locator(".pagination-summary").first()).toHaveCSS("font-size", "13px");
    await screenshot("transactions");
    const rowDetail = await openKeepsPageStill(
      page,
      financialTable(page).locator("tbody tr").first(),
      page.getByRole("dialog", { name: "Transaction details", exact: true }),
    );
    await checkDrawer(rowDetail, {
      width: "record",
      title: "Transaction details",
      context: "DESIGN-001 · Amazon.com · 2026-09-01",
    });
    const drawerFrame = await dialogFrame(rowDetail);
    await expect(
      rowDetail.getByRole("button", { name: "Show transactions for DESIGN-001" }),
    ).toHaveCSS("text-decoration-line", "underline");
    await screenshot("transaction-details");
    if (role === "administrator") await checkMetadata(rowDetail);
    await closeDrawer(rowDetail);
    await expect(page.locator("html")).not.toHaveCSS("overflow-y", "hidden");

    // Modals share the drawer's header, title and padding, and cover the whole window.
    const dates = await openKeepsPageStill(
      page,
      page.getByRole("button", { name: "Choose dates · UTC", exact: true }),
      page.getByRole("dialog", { name: "Choose summary dates", exact: true }),
    );
    expect(await dialogFrame(dates)).toEqual(drawerFrame);
    expect(
      await page
        .locator(".mantine-Modal-overlay")
        .evaluate((element) => element.getBoundingClientRect().width === globalThis.innerWidth),
    ).toBe(true);
    await screenshot("summary-dates");
    await dates.getByRole("button", { name: "Close summary dates", exact: true }).click();
    await expect(dates).toBeHidden();

    if (role === "administrator") {
      for (const name of ["Finances", "User access"]) {
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
        const title = name === "User access" ? "User access details" : `${name} record details`;
        const details = page.getByRole("dialog", { name: title, exact: true });
        await checkDrawer(details, {
          width: "record",
          title,
          context: await details.locator(".detail-drawer-context").textContent(),
        });
        if (name === "User access")
          await expect(details.locator(".detail-drawer-context")).toHaveText(/^\S+@\S+ · \S/);
        await checkMetadata(details);
        await screenshot(`${name.toLowerCase().replaceAll(" ", "-")}-details`);
        await closeDrawer(details);
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
    await checkStatusBadge(fees.locator(".ui-status-badge").first(), "success");
    await expect(fees.locator('[data-column="fee-rate"]').first()).toHaveText("5%");
    await feeRow(page, "DESIGN-SKU").click();
    await checkDrawer(feeDetails(page), {
      width: "wide",
      title: "Fee details",
      context: "DESIGN-SKU · Workspace Company",
    });
    await checkTable(
      page.getByRole("table", { name: "Marketplace fees for DESIGN-SKU", exact: true }),
    );
    await screenshot("fees");
    if (role === "administrator") {
      await checkMetadata(feeDetails(page));
      await page.getByRole("button", { name: "Edit DESIGN-SKU", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Fee editor", exact: true });
      await checkDrawer(editor, {
        width: "wide",
        title: "Fee editor",
        context: "DESIGN-SKU · Workspace Company",
      });
      await checkMetadata(editor);
      await expect(editor.getByRole("button", { name: "Keep draft", exact: true })).toHaveCSS(
        "border-radius",
        "6px",
      );
      await screenshot("fee-editor");
      await closeDrawer(editor);
    } else {
      await closeDrawer(feeDetails(page));
    }

    if (role === "administrator") {
      await openTab("Companies");
      const companies = page.getByRole("table", { name: "Companies", exact: true });
      await checkTable(companies);
      await expect(
        companies.getByRole("columnheader", { name: "Actions", exact: true }),
      ).toHaveCount(0);
      await screenshot("company-list");
      await companyRow(page, "Workspace Company").click();
      await checkDrawer(companyDrawer(page), {
        width: "record",
        title: "Company details",
        context: "Workspace Company",
      });
      await screenshot("company-details");
      await checkMetadata(companyDrawer(page));
      await closeCompanyDetails(page);
      await page.getByRole("button", { name: "Add company", exact: true }).click();
      const addCompany = page.getByRole("dialog", { name: "Add company", exact: true });
      await expect(addCompany).toBeVisible();
      expect(await dialogFrame(addCompany)).toEqual(drawerFrame);
      await screenshot("add-company");
      await page.keyboard.press("Escape");
      await expect(addCompany).toBeHidden();
    }

    await openTab("Inventory");
    await checkTable(page.locator(".inventory-table"));
    await screenshot("inventory");
    await page.locator(".inventory-table tbody tr").first().press("Enter");
    await checkStatusBadge(page.locator(".inventory-table .inventory-health-label"), "danger");
    const inventory = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await checkDrawer(inventory, {
      width: "wide",
      title: "Inventory details",
      context: "DESIGN-SKU · Amazon.com",
    });
    await checkStatusBadge(inventory.locator(".inventory-health-label"), "danger");
    await checkMetadata(inventory);
    await screenshot("inventory-details");
    await closeDrawer(inventory);

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
    await checkStatusBadge(financialTable(page).locator(".ui-status-badge").first(), "success");
    await screenshot("payouts");
    await financialTable(page).locator("tbody tr.inspectable-row").first().click();
    const payoutDetail = page.getByRole("dialog", { name: "Payout report details", exact: true });
    await checkDrawer(payoutDetail, {
      width: "full",
      title: "Payout report details",
      context: await payoutDetail.locator(".detail-drawer-context").textContent(),
    });
    await checkStatusBadge(payoutDetail.locator(".ui-status-badge").first(), "success");
    await checkTable(payoutDetail.getByRole("table", { name: "Amount records", exact: true }));
    await screenshot("payout-details");
    if (role === "administrator") await checkMetadata(payoutDetail);
    await closeDrawer(payoutDetail);

    await openTab("Assignments");
    const assignments = assignmentTable(page);
    await checkTable(assignments);
    // The reference ID is the row header, set like the SKU label in Current fees.
    const reference = assignments.getByRole("rowheader", { name: "design-campaign", exact: true });
    await expect(reference).toHaveCSS("font-size", "13px");
    await expect(reference).toHaveCSS("font-weight", "500");
    if (role === "administrator")
      await checkStatusBadge(assignments.locator(".ui-status-badge").first(), "success");
    await screenshot("assignments");
    await assignments.locator("tbody tr.inspectable-row").first().press("Enter");
    const assignment = assignmentDrawer(page);
    const assignmentScope = { width: "record", context: "design-campaign · Campaign · Amazon.com" };
    await checkDrawer(assignment, { ...assignmentScope, title: "Assignment details" });
    await screenshot("assignment-details");
    if (role === "administrator") {
      await checkTable(assignment.getByRole("table", { name: "Product ownership", exact: true }));
      await checkTable(assignment.getByRole("table", { name: "Assignment history", exact: true }));
      await expect(
        assignment.getByRole("button", { name: "Show transactions for DESIGN-SKU", exact: true }),
      ).toHaveCSS("text-decoration-line", "underline");
      await checkMetadata(assignment);
      await assignment.getByRole("button", { name: "Edit design-campaign", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Assignment editor", exact: true });
      await checkDrawer(editor, { ...assignmentScope, title: "Assignment editor" });
      await screenshot("assignment-editor");
      await closeDrawer(editor);
    } else {
      // Members read the facts only: no products, history or metadata.
      await expect(assignment.getByRole("table")).toHaveCount(0);
      await closeDrawer(assignment);
    }

    if (role === "administrator") {
      await openTab("Financial review");
      const months = page.getByRole("table", { name: "Months", exact: true });
      await checkTable(months);
      await screenshot("financial-review");
      await months.locator("tbody tr.inspectable-row").first().press("Enter");
      const january = new Date(`${REVIEW_JANUARY}-01T00:00:00Z`).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      const review = reviewDrawer(page, january);
      await checkDrawer(review, {
        width: "wide",
        title: january,
        context: "Amazon.com · USD",
        // A month is a name: its close label keeps the title's case.
        closeLabel: `Close ${january}`,
      });
      await checkTable(review.getByRole("table", { name: "Differences by reason", exact: true }));
      await checkTable(review.getByRole("table", { name: "Difference records", exact: true }));
      await screenshot("financial-review-month");
      await closeDrawer(review);
    } else {
      await expect(page.getByRole("tab", { name: "Financial review", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
    }
  });
}
