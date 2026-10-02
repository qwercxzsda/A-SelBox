import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";

const companyId = "0198b50b-701a-7000-8000-000000000001";
const reportId = "0198b50b-701a-7000-8000-000000000002";
const date = "2026-06-30";
const fields = ["reportedAmount", "serviceFee", "companyAmount"];
const labels = ["Reported amount", "Service fee", "Company amount"];

function recordRow(table, sku) {
  return table.getByRole("row").filter({ hasText: sku });
}

// These small integer fixtures derive every API response from the same records.
// Explicit assertions below independently check each expected amount.
function sumKnown(rows, field) {
  const known = rows.map((row) => row[field]).filter((value) => value !== null);
  return known.length ? String(known.reduce((sum, value) => sum + Number(value), 0)) : null;
}

function totals(rows) {
  return {
    serviceFee: sumKnown(rows, "fee_amount"),
    companyAmount: sumKnown(rows, "company_amount"),
    rowCount: rows.length,
    knownCompanyCount: rows.filter((row) => row.company_amount !== null).length,
  };
}

function record(type, amount, index, fee = "0") {
  return {
    ...liveRow(type, index, companyId),
    activity_date: date,
    component_type: type,
    source_amount: amount,
    fee_amount: fee,
    company_amount: fee === null ? null : String(Number(amount) + Number(fee)),
    resolution_status: fee === null ? "MISSING_FEE" : fee === "0" ? "NOT_APPLICABLE" : "APPLIED",
    fee_base: fee === "0" ? null : amount,
    fee_rate_percent: fee === "0" || fee === null ? null : "5",
  };
}

async function setRecords(page, rows, user = "member-a", role = "company_member") {
  const fixture = await mockSupabase(page);
  fixture.roles[user] = role;
  fixture.companyIds[user] = companyId;
  fixture.companyNames[companyId] = "Alignment Company";
  fixture.liveRows = rows;
  fixture.assignments = skuAssignments(
    rows.map((row) => row.sku),
    companyId,
  );
  fixture.aggregateRows = [summaryBucket(date, sumKnown(rows, "source_amount"), totals(rows))];
  fixture.breakdownRows = [...new Set(rows.map((row) => row.component_type))].map((type) => {
    const selected = rows.filter((row) => row.component_type === type);
    return typeBucket(type, sumKnown(selected, "source_amount"), totals(selected));
  });
  return fixture;
}

async function openEstimate(page, user = "member-a") {
  await signIn(page, user);
  await applyDates(page, "2026-06-01", date);
  await page.getByRole("button", { name: "View Selected dates by type", exact: true }).click();
  return page.getByRole("dialog", { name: "Amounts by type", exact: true });
}

async function assertTotals(drawer, expected, missing = false) {
  for (const name of ["Breakdown total", "Amounts by type total"]) {
    const total = drawer.getByRole("region", { name, exact: true });
    const footer = name === "Amounts by type total";
    await expect(total.locator(footer ? ".type-breakdown-group-value" : "dd")).toHaveText(expected);
    await expect(total.locator(footer ? ".type-breakdown-group-field" : "dt")).toHaveText([
      "Reported amount",
      "Service fee",
      missing ? "Known company amount" : "Company amount",
    ]);
  }
  const prominence = await drawer.evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    const total = element.querySelector(".type-breakdown-total");
    const primary = total.querySelector(".financial-amounts > div:last-child dd");
    const category = element.querySelector(
      '.type-breakdown-groups [data-amount="companyAmount"] .type-breakdown-group-value',
    );
    return {
      primaryFont: Number.parseFloat(view.getComputedStyle(primary).fontSize),
      reportedFont: Number.parseFloat(view.getComputedStyle(total.querySelector("dd")).fontSize),
      categoryFont: Number.parseFloat(view.getComputedStyle(category).fontSize),
      totalBackground: view.getComputedStyle(total).backgroundColor,
      categoryBackground: view.getComputedStyle(category.closest("button")).backgroundColor,
      width: total.clientWidth,
      scrollWidth: total.scrollWidth,
    };
  });
  expect(prominence.primaryFont).toBeGreaterThan(prominence.reportedFont);
  expect(prominence.primaryFont).toBeGreaterThan(prominence.categoryFont);
  expect(prominence.totalBackground).not.toBe(prominence.categoryBackground);
  expect(prominence.scrollWidth).toBeLessThanOrEqual(prominence.width + 1);
}

async function assertHeaderAmounts(drawer, name, amounts, missing = false) {
  const group = drawer.getByRole("button", { name: `${name} details`, exact: true });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  for (const [index, field] of fields.entries()) {
    const cell = group.locator(`[data-amount="${field}"]`);
    await expect(cell.locator(".type-breakdown-group-field")).toHaveText(
      missing && field === "companyAmount" ? "Known company amount" : labels[index],
    );
    await expect(cell.locator(".type-breakdown-group-value")).toHaveText(amounts[index]);
  }
  return group;
}

for (const [user, role] of [
  ["operator", "operator"],
  ["member-a", "company_member"],
  ["member-b", "company_member"],
]) {
  for (const width of [1440, 390]) {
    test(`${user} sees every type amount reconcile with totals and records at ${width}px`, async ({
      page,
    }, testInfo) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      const rows = [
        record("PRODUCT_SALES", "1000", 1, "-50"),
        record("PRODUCT_REFUNDS", "-100", 2, "5"),
        record("SPONSORED_PRODUCT_FEE", "-700", 3),
        record("REFERRAL_FEE", "-150", 4),
        record("FBA_STORAGE_FEE", "0", 5),
      ];
      const fixture = await setRecords(page, rows, user, role);
      fixture.payoutRows = [
        {
          id: reportId,
          company_id: companyId,
          currency: "USD",
          start_date: "2026-06-01",
          end_date: date,
          created_at: "2026-09-27",
          source_amount: sumKnown(rows, "source_amount"),
          fee_amount: sumKnown(rows, "fee_amount"),
          company_amount: sumKnown(rows, "company_amount"),
        },
      ];
      fixture.payoutComponents = rows.map((row) => ({
        ...row,
        id: row.source_row_id,
        report_id: reportId,
        authoritative: "true",
      }));
      const estimate = await openEstimate(page, user);
      const expected = ["50 USD", "-45 USD", "5 USD"];
      await assertTotals(estimate, expected);
      const groups = [
        [
          "Sales and refunds",
          ["900 USD", "-45 USD", "855 USD"],
          ["PRODUCT_SALES", "PRODUCT_REFUNDS"],
        ],
        ["Sponsored Products charge", ["-700 USD", "0 USD", "-700 USD"], ["SPONSORED_PRODUCT_FEE"]],
        ["Referral fee", ["-150 USD", "0 USD", "-150 USD"], ["REFERRAL_FEE"]],
        ["Monthly inventory storage fee", ["0 USD", "0 USD", "0 USD"], ["FBA_STORAGE_FEE"]],
      ];
      for (const [name, amounts] of groups) await assertHeaderAmounts(estimate, name, amounts);
      for (const [index, field] of fields.entries()) {
        const rendered = await estimate
          .locator(`.type-breakdown-groups [data-amount="${field}"] .type-breakdown-group-value`)
          .allTextContents();
        expect(rendered).toHaveLength(groups.length);
        const sum = rendered.reduce(
          (total, value) => total + Number(value.replaceAll(",", "").replace(" USD", "")),
          0,
        );
        expect(`${sum} USD`).toBe(expected[index]);
      }
      const records = estimate.getByRole("table", { name: "Amount records", exact: true });
      await expect(records.getByRole("row")).toHaveCount(rows.length + 1);
      for (const row of rows) {
        const cells = recordRow(records, row.sku).getByRole("cell");
        for (const [index, field] of ["source_amount", "fee_amount", "company_amount"].entries())
          await expect(cells.nth(6 + index)).toHaveText(Number(row[field]).toLocaleString("en-US"));
      }
      await estimate
        .getByRole("button", { name: "Sales and refunds details", exact: true })
        .click();
      const sales = estimate.getByRole("region", {
        name: "Sales and refunds subtotal",
        exact: true,
      });
      await expect(sales.locator("dd")).toHaveText(groups[0][1]);
      await sales
        .getByRole("button", { name: "View Sales and refunds records", exact: true })
        .click();
      await expect(records.getByRole("row")).toHaveCount(3);
      await expect(recordRow(records, "PRODUCT_SALES-001")).toBeVisible();
      await expect(recordRow(records, "PRODUCT_REFUNDS-002")).toBeVisible();
      expect(fixture.summaryRecordRequests.at(-1).args.p_types).toEqual(groups[0][2]);
      await estimate
        .getByRole("button", { name: "View Product refunds records", exact: true })
        .click();
      await expect(records.getByRole("row")).toHaveCount(2);
      await expect(recordRow(records, "PRODUCT_REFUNDS-002")).toBeVisible();
      expect(fixture.summaryRecordRequests.at(-1).args.p_types).toEqual(["PRODUCT_REFUNDS"]);
      await estimate
        .getByRole("button", { name: "Sales and refunds details", exact: true })
        .click();
      for (const [name] of groups) {
        const group = estimate.getByRole("button", { name: `${name} details`, exact: true });
        await group.scrollIntoViewIfNeeded();
        const bounds = await group.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
      }
      await estimate
        .getByRole("region", { name: "Breakdown total", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("type-total-alignment.png"),
        animations: "disabled",
      });
      await estimate.getByRole("button", { name: "Close breakdown", exact: true }).click();
      await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
      await page.getByRole("cell", { name: "5 USD", exact: true }).last().click();
      const payout = page.getByRole("dialog", { name: "Selected row details", exact: true });
      await assertTotals(payout, expected);
      for (const [name, amounts] of groups) await assertHeaderAmounts(payout, name, amounts);
      await expect(
        payout.getByRole("table", { name: "Amount records", exact: true }).getByRole("row"),
      ).toHaveCount(6);
      expect(errors).toEqual([]);
    });
  }
}

for (const scenario of [
  {
    label: "all unknown",
    rows: [record("PRODUCT_SALES", "100", 1, null)],
    expected: ["100 USD", "—", "—"],
  },
  {
    label: "known zero with unknown",
    rows: [record("PRODUCT_SALES", "100", 1, null), record("FBA_STORAGE_FEE", "0", 2)],
    expected: ["100 USD", "0 USD", "0 USD"],
  },
]) {
  test(`every displayed total preserves ${scenario.label} amounts`, async ({ page }) => {
    await setRecords(page, scenario.rows);
    const estimate = await openEstimate(page);
    await assertTotals(estimate, scenario.expected, true);
    await assertHeaderAmounts(estimate, "Sales and refunds", ["100 USD", "—", "—"], true);
    await expect(
      estimate.getByRole("region", { name: "Breakdown total", exact: true }),
    ).toContainText("1 transaction has uncalculated amounts.");
    const records = estimate.getByRole("table", { name: "Amount records", exact: true });
    await expect(recordRow(records, "PRODUCT_SALES-001").getByRole("cell").nth(8)).toHaveText("—");
    if (scenario.rows.length > 1) {
      await assertHeaderAmounts(estimate, "Monthly inventory storage fee", [
        "0 USD",
        "0 USD",
        "0 USD",
      ]);
      await expect(recordRow(records, "FBA_STORAGE_FEE-002").getByRole("cell").nth(8)).toHaveText(
        "0",
      );
    }
  });
}
