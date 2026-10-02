import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth, openColumn } from "./table-actions.mjs";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const COMPANY_NAME = "Applied filters international distribution company with a very long name";
const LONG_SKU = "APPLIED-FILTERS-LONG-SKU-WITH-MANY-SEGMENTS-AND-A-VERY-LONG-VARIANT-NAME";
const OTHER_SKU = "APPLIED-FILTERS-SECOND-SKU";
const appliedFilters = (page) => page.getByRole("group", { name: "Applied table filters" });

async function selectOptions(page, column, options) {
  const menu = await openColumn(page, column);
  for (const option of options) {
    await menu.getByRole("checkbox", { name: option, exact: true }).check();
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

async function expectCenteredChip(chip) {
  await expect(chip).toBeVisible();
  const geometry = await chip.evaluate((button) => {
    const textBoxes = [];
    const walker = globalThis.document.createTreeWalker(button, globalThis.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = globalThis.document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      textBoxes.push({ text: node.textContent.trim(), center: box.y + box.height / 2 });
    }
    const close = textBoxes.find(({ text }) => text === "×");
    const label = textBoxes.filter(({ text }) => text !== "×");
    const box = button.getBoundingClientRect();
    return {
      labelCenters: label.map(({ center }) => center),
      closeCenter: close?.center,
      buttonCenter: box.y + box.height / 2,
      left: box.left,
      right: box.right,
    };
  });
  expect(geometry.labelCenters.length).toBeGreaterThan(0);
  expect(geometry.closeCenter).toBeDefined();
  for (const center of geometry.labelCenters) {
    expect(Math.abs(center - geometry.closeCenter)).toBeLessThanOrEqual(2);
    expect(Math.abs(center - geometry.buttonCenter)).toBeLessThanOrEqual(2);
  }
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(chip.page().viewportSize().width);
}

test("clearing payout column filters stays cleared after F5", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.companyIds["member-b"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await selectOptions(page, "Company", [COMPANY_NAME]);
  await applyReportMonth(page, "2026-06");
  await expect(appliedFilters(page)).toContainText("2 filters applied");
  await expect.poll(() => fixture.requests.at(-1).params.get("start_date")).toBe("gte.2026-06-01");

  await appliedFilters(page).getByRole("button", { name: "Clear filters", exact: true }).click();
  for (let pass = 0; pass < 2; pass += 1) {
    await expect(appliedFilters(page)).toHaveCount(0);
    await expect(page.getByLabel("Report company", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report month", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report versions", { exact: true })).toHaveCount(0);
    if (pass === 0) await page.reload();
  }
  await expect
    .poll(() => fixture.requests.at(-1).endpoint)
    .toBe("/rest/v1/latest_company_payout_reports");
  await expect.poll(() => fixture.requests.at(-1).params.get("company_id")).toBeNull();
  await expect.poll(() => fixture.requests.at(-1).params.get("start_date")).toBeNull();
});

for (const [role, width] of [
  ["operator", 1440],
  ["operator", 834],
  ["operator", 390],
  ["company_member", 390],
]) {
  test(`${role} applied filters fit and remove only the chosen filter at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.companyIds = { "member-a": COMPANY, "member-b": COMPANY };
    fixture.companyNames = { [COMPANY]: COMPANY_NAME };
    fixture.assignments = skuAssignments([LONG_SKU, OTHER_SKU], COMPANY);
    fixture.liveRows = [LONG_SKU, OTHER_SKU].map((sku, index) => ({
      ...liveRow("APPLIED", index + 1, COMPANY),
      sku,
    }));
    await signIn(page);
    await page.getByLabel("Search", { exact: true }).fill("Amazon");
    await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("Amazon");
    if (role === "operator") await selectOptions(page, "Company", [COMPANY_NAME]);
    await selectOptions(page, "Marketplace", ["Amazon.com"]);
    await selectOptions(page, "SKU", [LONG_SKU]);
    const skuChip = appliedFilters(page).getByRole("button", {
      name: `Clear sku filter: ${LONG_SKU}`,
      exact: true,
    });
    await expectCenteredChip(skuChip);
    if (role === "operator") {
      await expectCenteredChip(
        appliedFilters(page).getByRole("button", {
          name: `Clear company filter: ${COMPANY_NAME}`,
          exact: true,
        }),
      );
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`applied-filters-${role}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    await selectOptions(page, "SKU", [OTHER_SKU]);
    const multipleSkus = appliedFilters(page).getByRole("button", {
      name: /^Clear sku filter:/,
    });
    await expect(multipleSkus).toContainText("SKU: 2 selected");
    await expectCenteredChip(multipleSkus);
    await multipleSkus.click();
    await expect(multipleSkus).toHaveCount(0);
    await expect(
      appliedFilters(page).getByRole("button", {
        name: "Clear marketplace filter: Amazon.com",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Amazon");
    await page.reload();
    await expect(
      appliedFilters(page).getByRole("button", { name: /^Clear sku filter:/ }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Amazon");
    await expect.poll(() => fixture.requests.at(-1).args.p_skus).toEqual([]);
    expect(fixture.requests.at(-1).args.p_marketplaces).toEqual(["Amazon.com"]);
    expect(fixture.requests.at(-1).args.p_company_ids).toEqual(
      role === "operator" ? [COMPANY] : [],
    );
    await expect(
      appliedFilters(page).getByRole("button", {
        name: "Clear marketplace filter: Amazon.com",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
  });
}
