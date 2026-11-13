import { expect, test } from "./accessibility-fixture.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { applySummaryDates, openColumn } from "./table-actions.mjs";
import { summaryBucket } from "./summary-fixtures.mjs";
import marketplaces from "../../src/generated/marketplaces.json" with { type: "json" };
import { openSourceLookup, sourceDetail } from "./financial-source-fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import {
  editor,
  openEditor,
  openReview,
  review,
  setup,
  feeRow,
  feeDetails,
} from "./sku-configuration-fixtures.mjs";
import { companyRow, companyDrawer, closeCompanyDetails } from "./company-actions.mjs";
import { liveRow } from "./api-fixtures.mjs";

for (const mode of ["sign-in", "sign-up", "recover"]) {
  test(`accessibility: ${mode} form`, async ({ page, expectAccessible }) => {
    await mockSupabase(page);
    if (mode !== "sign-in") {
      await page
        .getByRole("button", {
          name: mode === "sign-up" ? "New to A-SelBox? Create an account" : "Forgot password?",
          exact: true,
        })
        .click();
    }
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    await expectAccessible(mode);
  });
}

test("accessibility: sign-in error feedback on a phone", async ({ page, expectAccessible }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSupabase(page);
  await page.route("**/auth/v1/token*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "These credentials could not be verified." }),
    }),
  );
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("qa@example.test");
  await page.getByLabel(/^Password/).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expectAccessible("sign-in-error-phone");
});

for (const role of ["member", "administrator"]) {
  test(`accessibility: ${role} transactions and type filter`, async ({
    page,
    expectAccessible,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expectAccessible(`${role}-transactions`);
    const filter = await openColumn(page, "Type");
    await expect(filter.getByRole("checkbox").first()).toBeVisible();
    await expectAccessible(`${role}-type-filter`);
  });
}

for (const width of [1440, 390]) {
  test(`accessibility: type labels and secondary browsing groups at ${width}px`, async ({
    page,
    expectAccessible,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.liveRows = [
      { ...liveRow("TYPE", 1), component_type: "PRODUCT_SALES" },
      {
        ...liveRow("TYPE", 2),
        source: "DATA_KIOSK",
        category: "DATA_KIOSK",
        component_type: "FBA_STORAGE_FEE",
      },
      { ...liveRow("TYPE", 3), component_type: "EXPERIMENTAL_TAX_FEE" },
    ];
    await signIn(page);
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await table.scrollIntoViewIfNeeded();
    for (const [sku, label, group] of [
      ["TYPE-001", "Product sales", "Sales & refunds"],
      ["TYPE-002", "FBA storage fee", "Storage & inventory"],
      ["TYPE-003", "Experimental tax fee", "Other fees & adjustments"],
    ]) {
      const row = rowWithSku(page, sku);
      await expect(row.locator(".transaction-type-label")).toHaveText(label);
      await expect(row.locator(".transaction-type-group")).toHaveText(group);
      const sizes = await row.locator(".transaction-type").evaluate((element) => ({
        primary: Number.parseFloat(
          globalThis.getComputedStyle(element.querySelector(".transaction-type-label")).fontSize,
        ),
        secondary: Number.parseFloat(
          globalThis.getComputedStyle(element.querySelector(".transaction-type-group")).fontSize,
        ),
      }));
      expect(sizes.primary).toBeGreaterThan(sizes.secondary);
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expectAccessible(`type-groups-${width}`);
  });
}

test("accessibility: source lookup and retained source detail", async ({
  page,
  expectAccessible,
}) => {
  const { opener } = await openSourceLookup(page);
  await expectAccessible("source-lookup");
  await opener.click();
  await expect(
    sourceDetail(page).getByRole("heading", { name: "RETAINED-00", exact: true }),
  ).toBeVisible();
  await expectAccessible("retained-source-detail");
});

test("accessibility: source error and recovery action", async ({ page, expectAccessible }) => {
  const { state, opener } = await openSourceLookup(page);
  state.status = 403;
  await opener.click();
  await expect(sourceDetail(page).getByRole("alert")).toBeVisible();
  await expectAccessible("source-error");
});

test("accessibility: financial review and monthly detail", async ({ page, expectAccessible }) => {
  await openFinancialReview(page);
  const openMonth = page.getByRole("button", { name: "Open review for July 2026", exact: true });
  await expect(openMonth).toBeVisible();
  await expectAccessible("financial-review");
  await openMonth.click();
  const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(monthly.getByRole("table", { name: "Amounts by type", exact: true })).toBeVisible();
  await expectAccessible("monthly-review-detail");
});

test("accessibility: fee editor and change review on a phone", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Show fee periods for S1", exact: true }).click();
  await expectAccessible("fee-period-groups-phone");
  await feeRow(page, "S1").press("Enter");
  await expect(feeDetails(page)).toBeVisible();
  await expectAccessible("fee-details-phone");
  await openEditor(page);
  const rate = editor(page).getByLabel("Fee rate 1 (%)", { exact: true });
  await expect(rate).toHaveValue("5");
  await expectAccessible("fee-editor-phone");
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const preview = editor(page).getByRole("region", { name: "Change rate from date", exact: true });
  await preview.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
  await preview.getByLabel("New fee rate (%)", { exact: true }).fill("6.25");
  await preview.getByRole("button", { name: "Preview rate change", exact: true }).click();
  const apply = preview.getByRole("button", { name: "Use rate change in draft", exact: true });
  await expect(apply).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  await expectAccessible("fee-rate-preview-phone");
  await apply.click();
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeVisible();
  await expectAccessible("fee-review-phone");
});

test("accessibility: companies and member assignment", async ({ page, expectAccessible }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await signIn(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await expect(page.getByRole("table", { name: "Companies", exact: true })).toBeVisible();
  await expectAccessible("companies");
  await companyRow(page, "Company A").press("Enter");
  await expect(companyDrawer(page)).toBeVisible();
  await expectAccessible("company-details");
  await closeCompanyDetails(page);
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toBeVisible();
  await expectAccessible("company-creation");
  await page.getByRole("button", { name: "Close company creation", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add company", exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  const member = page.getByRole("row").filter({
    has: page.getByText("member-b@example.test", { exact: true }),
  });
  await expect(member).toBeVisible();
  await expectAccessible("user-access");
  await member.click();
  const membership = page.getByRole("dialog", { name: "Company membership", exact: true });
  await expect(membership.getByRole("combobox", { name: "Company", exact: true })).toBeVisible();
  await expectAccessible("membership-editor");
});

for (const width of [1440, 390]) {
  test(`accessibility: three marketplace cards and shared date chooser at ${width}px`, async ({
    page,
    expectAccessible,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [
      summaryBucket("2026-06-30", "100", { marketplace: "Amazon.com" }),
      summaryBucket("2026-06-30", "80", { marketplace: "Amazon.com", currency: "EUR" }),
      summaryBucket("2026-06-29", "5000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
    ];
    await signIn(page);
    const totals = page.getByRole("region", { name: "Current totals", exact: true });
    await expect(totals).toHaveAttribute("aria-busy", "false");
    const table = totals.getByRole("table", { name: "Last day marketplace totals", exact: true });
    await expect(table.locator("tbody[data-marketplace]")).toHaveCount(marketplaces.length);
    await expect(totals.getByRole("radiogroup")).toHaveCount(0);
    for (const title of ["Last day", "Last month", "Selected dates"]) {
      await expect(
        totals.getByRole("article", { name: `${title} totals`, exact: true }),
      ).toBeVisible();
    }
    await expect(table.getByRole("button", { name: /^Filter transactions to / })).toHaveCount(0);
    await expect(
      totals.getByRole("article", { name: "Last day totals", exact: true }).getByRole("button", {
        name: "Filter transactions to Jun 29, 2026 · UTC",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      totals.getByRole("article", { name: "Last month totals", exact: true }).getByRole("button", {
        name: "Filter transactions to May 2026 · UTC",
        exact: true,
      }),
    ).toHaveCount(1);
    await expectAccessible(`three-totals-${width}`);
    await expect(
      totals.getByRole("table", { name: "Last month marketplace totals", exact: true }),
    ).toBeVisible();
    await expectAccessible(`three-month-totals-${width}`);
    await totals.getByRole("button", { name: "Choose dates · UTC", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
    await expect(chooser).toBeVisible();
    await expectAccessible(`three-summary-date-chooser-${width}`);
    await chooser.getByRole("button", { name: "Close summary dates", exact: true }).click();
    const selectedCard = totals.getByRole("article", {
      name: "Selected dates totals",
      exact: true,
    });
    const dateControl = selectedCard.getByRole("button", {
      name: "Choose dates · UTC",
      exact: true,
    });
    await expect(dateControl).toBeFocused();
    for (const title of ["Last day", "Last month", "Selected dates"]) {
      const heading = totals
        .getByRole("article", { name: `${title} totals`, exact: true })
        .locator(".totals-card-heading");
      await expect(heading.getByRole("button")).toHaveCount(1);
      await expect(heading.getByRole("button")).toContainText("UTC");
      const control = heading.getByRole("button");
      await expect(control).toHaveAttribute(
        "data-action",
        title === "Selected dates" ? "select" : "filter",
      );
      await expect(control.locator(".totals-calendar-icon")).toHaveCount(
        title === "Selected dates" ? 1 : 0,
      );
      await expect(control.locator(".totals-filter-icon")).toHaveCount(
        title === "Selected dates" ? 0 : 1,
      );
    }
    await expect(totals.locator(".totals-utc-badge")).toHaveCount(0);
    await expect(totals.getByRole("button", { name: "Change dates", exact: true })).toHaveCount(0);
    await dateControl.press("Space");
    await expect(chooser).toBeVisible();
    await chooser.getByLabel("From date", { exact: true }).fill("2026-06-01");
    await chooser.getByLabel("To date", { exact: true }).fill("2026-06-30");
    await chooser.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(chooser).toBeHidden();
    const compactControl = selectedCard.getByRole("button", {
      name: "Change dates: Jun 1–30, 2026 · UTC",
      exact: true,
    });
    await expect(compactControl).toHaveText("Jun 1–30, 2026 · UTC");
    await expect(compactControl).toBeFocused();
    await compactControl.press("Enter");
    await expect(chooser).toBeVisible();
    await chooser.getByLabel("From date", { exact: true }).fill("2025-12-31");
    await chooser.getByLabel("To date", { exact: true }).fill("2026-11-06");
    await chooser.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(chooser).toBeHidden();
    const changedControl = selectedCard.getByRole("button", {
      name: "Change dates: Dec 31, 2025 – Nov 6, 2026 · UTC",
      exact: true,
    });
    await expect(changedControl).toHaveText("Dec 31, 2025 – Nov 6, 2026 · UTC");
    await expect(changedControl).toBeFocused();
    const bounds = await changedControl.boundingBox();
    const cardBounds = await selectedCard.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(cardBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width + 1);
    const heading = selectedCard.locator(".totals-card-heading");
    const titleBounds = await selectedCard
      .getByRole("heading", { name: "Selected dates", exact: true })
      .boundingBox();
    const rightInset = await heading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.right - Number.parseFloat(globalThis.getComputedStyle(element).paddingRight);
    });
    expect(bounds.x).toBeGreaterThanOrEqual(titleBounds.x + titleBounds.width + 5);
    expect(bounds.x + bounds.width).toBeCloseTo(rightInset, 0);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expectAccessible(`unified-selected-date-control-${width}`);
  });
}

test("marketplace rows align across the three cards with unequal currencies and empty periods", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    // A current-day posting leaves November 6 as the Last day period.
    summaryBucket("2026-11-07", "0"),
    summaryBucket("2026-11-06", "100", { marketplace: "Amazon.com" }),
    summaryBucket("2026-10-05", "80", { marketplace: "Amazon.com", currency: "EUR" }),
    summaryBucket("2026-11-06", "5000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
    summaryBucket("2026-11-06", "50", { marketplace: "Amazon.co.jp" }),
    summaryBucket("2026-10-03", "35", { marketplace: "Amazon.ca", currency: "CAD" }),
    summaryBucket("2026-10-02", "10", { marketplace: "Amazon.de", currency: "EUR" }),
    summaryBucket("2026-10-02", "20", { marketplace: "Amazon.de", currency: "GBP" }),
    summaryBucket("2026-10-02", "30", { marketplace: "Amazon.de" }),
    summaryBucket("2026-11-06", "12345678901234567890.123456789012345678", {
      marketplace: "Amazon.com.mx",
      currency: "MXN",
      companyAmount: null,
      serviceFee: null,
      knownCompanyCount: 0,
    }),
  ];
  await signIn(page);
  await applySummaryDates(page, "2026-10-01", "2026-11-06");
  await expect(
    page.getByRole("dialog", { name: "Choose summary dates", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Date (UTC): 2026-10-01 – 2026-11-06. Clear filter.",
      exact: true,
    }),
  ).toBeVisible();
  const totals = page.getByRole("region", { name: "Current totals", exact: true });
  await expect(totals).toHaveAttribute("aria-busy", "false");
  const tables = totals.getByRole("table");
  await expect(tables).toHaveCount(3);
  await expect(
    totals
      .getByRole("table", { name: "Last day marketplace totals", exact: true })
      .locator('tbody[data-marketplace="Amazon.de"] tr[data-currency]'),
  ).toHaveCount(0);
  await expect(
    totals
      .getByRole("table", { name: "Last month marketplace totals", exact: true })
      .locator('tbody[data-marketplace="Amazon.de"] tr[data-currency]'),
  ).toHaveCount(3);
  await expect(
    totals
      .getByRole("table", { name: "Selected dates marketplace totals", exact: true })
      .locator('tbody[data-marketplace="Amazon.com"] tr[data-currency]'),
  ).toHaveCount(2);

  const positions = await tables.evaluateAll((elements) =>
    elements.map((table) => {
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, height: bounds.height };
      };
      return {
        heading: rect(table.tHead),
        rows: Array.from(table.tBodies, (body) => ({
          marketplace: body.dataset.marketplace,
          ...rect(body),
        })),
      };
    }),
  );
  expect(positions[0].rows).toHaveLength(marketplaces.length);
  for (const comparison of positions.slice(1)) {
    expect(Math.abs(comparison.heading.top - positions[0].heading.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(comparison.heading.height - positions[0].heading.height)).toBeLessThanOrEqual(
      1,
    );
    expect(comparison.rows.map(({ marketplace }) => marketplace)).toEqual(
      positions[0].rows.map(({ marketplace }) => marketplace),
    );
    for (const [index, row] of comparison.rows.entries()) {
      expect(
        Math.abs(row.top - positions[0].rows[index].top),
        `${row.marketplace} top`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(row.height - positions[0].rows[index].height),
        `${row.marketplace} height`,
      ).toBeLessThanOrEqual(1);
    }
  }
  for (const card of await totals.getByRole("article").all()) {
    expect(await card.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
      true,
    );
  }
  await expectAccessible("aligned-marketplace-cards-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator("html").evaluate((element) => element.scrollWidth))
    .toBeLessThanOrEqual(390);
  const cards = await totals.getByRole("article").all();
  for (const [index, card] of cards.entries()) {
    const bounds = await card.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await card.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
      true,
    );
    if (index > 0) {
      const previous = await cards[index - 1].boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(previous.y + previous.height);
    }
  }
  await expectAccessible("aligned-marketplace-cards-phone");
});
