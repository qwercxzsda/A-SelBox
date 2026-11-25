import { expect, test } from "@playwright/test";
import { setup, item, feeRow, feeDetails, editor } from "./sku-configuration-fixtures.mjs";

const requirement = (marketplace_name, valid_from, valid_to) => ({
  marketplace_name,
  valid_from,
  valid_to,
});
// Required days without a fee rate, deliberately out of order.
const GAPS = [
  requirement("Amazon.it", "2026-06-04", "2026-06-05"),
  requirement("Amazon.de", "2026-03-02", "2026-03-03"),
  requirement("Amazon.it", "2025-11-07", "2025-11-08"),
];
const PERIOD_DATE_HEADERS = ["Effective from (inclusive)", "Effective until (exclusive)"];
const EXPECTED_ROWS = [
  ["Amazon.de", "2026-03-02", "2026-03-03"],
  ["Amazon.it", "2025-11-07", "2025-11-08"],
  ["Amazon.it", "2026-06-04", "2026-06-05"],
];

async function expectGapTable(scope) {
  const alert = scope.getByRole("alert").filter({ hasText: "Needs setup" });
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText(/inclusive|exclusive|needs a fee rate/);
  await expect(alert.getByText("Missing fee rates", { exact: true })).toBeVisible();
  const table = alert.getByRole("table", { name: "Missing fee rates for S1", exact: true });
  await expect(table.getByRole("columnheader")).toHaveText([
    "Marketplace",
    "Effective from",
    "Effective until",
  ]);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(EXPECTED_ROWS.length);
  for (const [index, cells] of EXPECTED_ROWS.entries())
    await expect(rows.nth(index).getByRole("cell")).toHaveText(cells);
  // Aligned columns: every date in a column starts at the same x position.
  const starts = await rows.evaluateAll((elements) =>
    elements.map((row) => [...row.cells].map((cell) => Math.round(cell.getBoundingClientRect().x))),
  );
  for (const row of starts) expect(row).toEqual(starts[0]);
  return table;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`missing fee rates read as an aligned table at ${String(viewport.width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await setup(page, "administrator", [item("S1", { requirements: GAPS })]);
    const header = page.getByRole("table", { name: "Current fee configurations", exact: true });
    await expect(header.getByRole("columnheader", { name: /^Effective/ })).toHaveText(
      PERIOD_DATE_HEADERS,
    );
    await feeRow(page, "S1").press("Enter");
    const table = await expectGapTable(feeDetails(page));
    const frame = await table.boundingBox();
    const drawer = await feeDetails(page).boundingBox();
    expect(frame.x + frame.width).toBeLessThanOrEqual(drawer.x + drawer.width);
    // The fee schedule names its dates like the list, and fits the drawer without page overflow.
    const schedule = feeDetails(page).getByRole("table", {
      name: "Marketplace fees for S1",
      exact: true,
    });
    await expect(schedule.getByRole("columnheader")).toHaveText([
      "Marketplace",
      "Fee rate",
      ...PERIOD_DATE_HEADERS,
    ]);
    await expect(schedule.getByRole("row").nth(1).getByRole("cell")).toHaveText([
      "Amazon.com",
      "5%",
      "2026-09-01",
      "No end date",
    ]);
    // The table stays inside the drawer (scrolling in its own region if needed), never the page.
    const scheduleFrame = await schedule.locator("..").boundingBox();
    expect(scheduleFrame.x + scheduleFrame.width).toBeLessThanOrEqual(drawer.x + drawer.width);
    await expect(schedule.locator("..")).toHaveAttribute("tabindex", "0");
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await feeDetails(page).getByRole("button", { name: "Edit S1", exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await expectGapTable(editor(page));
    // Period 2 is the pre-added Amazon.it period from its earliest missing day.
    await expect(
      editor(page).getByLabel("Effective from 2 (inclusive)", { exact: true }),
    ).toHaveValue("2025-11-07");
    await expect(
      editor(page).getByLabel("Effective until 2 (exclusive)", { exact: true }),
    ).toHaveValue("");
    // Pre-added gap periods start blank and quiet; an error appears once the user leaves the field.
    const gapRate = editor(page).getByLabel("Fee rate 2 (%)", { exact: true });
    const rateError = editor(page).getByText("Enter 0–100, up to 6 decimals.", { exact: true });
    await expect(gapRate).toBeFocused();
    await expect(editor(page).locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(rateError).toHaveCount(0);
    await gapRate.blur();
    await expect(gapRate).toHaveAttribute("aria-invalid", "true");
    await expect(rateError).toBeVisible();
    await expect(editor(page).getByLabel("Fee rate 3 (%)", { exact: true })).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
