import { expect, test } from "@playwright/test";
import {
  OTHER_COMPANY,
  editor,
  item,
  period,
  setup,
  version,
} from "./sku-configuration-fixtures.mjs";
import { openColumn, selectColumnOptions } from "./table-actions.mjs";

const summaryTable = (page) =>
  page.getByRole("table", { name: "Current fee configurations", exact: true });
const summaryRows = (page) =>
  summaryTable(page).locator(":scope > tbody > .expandable-summary-row");
const row = (page, sku) =>
  summaryRows(page).filter({
    has: page.getByRole("button", { name: `Show transactions for ${sku}`, exact: true }),
  });
const toggle = (page, sku) =>
  row(page, sku).getByRole("button", { name: `marketplace fees for ${sku}: ` });
const details = (page, sku) =>
  page.getByRole("region", { name: `Fee periods for ${sku}`, exact: true });
const japan = {
  marketplace_name: "Amazon.co.jp",
  valid_from: "2026-09-01",
  valid_to: "2026-09-03",
};

test("fee column filters intersect company, required marketplaces and status and persist independently", async ({
  page,
}) => {
  await setup(
    page,
    "administrator",
    [
      item("S1"),
      item("S2", {
        company_id: OTHER_COMPANY,
        periods: [{ ...period(), ...japan }],
        requirements: [japan],
      }),
      item("S3", { periods: [{ ...period(), ...japan }], requirements: [japan] }),
      item("S4", { periods: [], requirements: [japan] }),
    ].map((row, index) => ({
      ...row,
      sku_id: version(index + 1),
      terms_version_id: version(index + 11),
    })),
  );
  await expect(page.getByRole("checkbox", { name: "Needs setup only", exact: true })).toHaveCount(
    0,
  );
  await selectColumnOptions(page, "Company", ["Alpha Company"]);
  await selectColumnOptions(page, "Marketplaces", ["Amazon.co.jp"]);
  await selectColumnOptions(page, "Status", ["Needs setup"]);
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S4")).toBeVisible();
  await expect(row(page, "S4")).toContainText("Amazon.co.jp");
  await page.reload();
  await expect(row(page, "S4")).toBeVisible();
  await expect(summaryRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Status: Needs setup", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
  await selectColumnOptions(page, "Status", ["Saved"]);
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S3")).toBeVisible();
  await page.getByRole("button", { name: "Remove Company: Alpha Company", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
  await selectColumnOptions(page, "Status", ["Needs setup"]);
  await expect(summaryRows(page)).toHaveCount(3);
  const menu = await openColumn(page, "Status");
  await expect(menu.getByRole("checkbox", { name: "Saved", exact: true })).toBeChecked();
  await expect(menu.getByRole("checkbox", { name: "Needs setup", exact: true })).toBeChecked();
});

for (const width of [1440, 390]) {
  test(`fee rows expand together by row and chevron, retain focus and isolate actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, "administrator", [item("S1"), item("S2"), item("S3", { company_id: null })]);
    await row(page, "S1").locator("td.numeric").click();
    await expect(toggle(page, "S1")).toBeFocused();
    await expect(details(page, "S1")).toBeVisible();
    await toggle(page, "S2").focus();
    await page.keyboard.press("Enter");
    await expect(details(page, "S2")).toBeVisible();
    await expect(details(page, "S1")).toBeVisible();
    await page.reload();
    await expect(details(page, "S1")).toBeVisible();
    await expect(details(page, "S2")).toBeVisible();
    await row(page, "S3").getByRole("button", { name: "Edit S3", exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor(page)).toBeHidden();
    await expect(toggle(page, "S3")).toHaveAttribute("aria-expanded", "false");
    await expect(details(page, "S1")).toBeVisible();
    await expect(details(page, "S2")).toBeVisible();
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await expect(details(page, "S1")).toHaveCount(0);
    await expect(details(page, "S2")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Current fee configurations table", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Collapse all", exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    ).toBe(true);
  });
}
