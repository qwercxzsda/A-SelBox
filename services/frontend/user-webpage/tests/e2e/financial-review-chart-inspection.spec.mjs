import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";

const chart = (page) =>
  page.getByRole("figure", { name: "Monthly and running source gaps", exact: true });
const inspector = (page) => chart(page).getByRole("region", { name: "Chart values", exact: true });

test("visible chart values follow hover, keyboard and the month selector while preserving drilldown", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  const selection = inspector(page).getByRole("combobox", { name: "Chart month", exact: true });
  const totals = inspector(page).locator(".financial-review-chart-value-totals dd");
  await expect(selection).toHaveValue("2026-03");
  await expect(totals).toHaveText(["0.00", "-7.01"]);
  const legend = chart(page).getByRole("list", { name: "Type family legend", exact: true });
  await expect(legend.locator('[data-family-id="source:FINANCES:FUTURE_FEE"]')).toContainText(
    "Unpaired amount (Finances)",
  );
  await expect(
    legend.locator('[data-family-id="monthly-storage"] .financial-review-chart-context'),
  ).toHaveCount(0);
  await expect(
    inspector(page).locator(".financial-review-chart-family-value").first(),
  ).toHaveAttribute("data-family-id", "monthly-storage");
  await chart(page)
    .getByRole("button", { name: "Feb: View chart details for February 2026", exact: true })
    .hover();
  await expect(selection).toHaveValue("2026-02");
  await expect(totals).toHaveText(["3.99", "-7.01"]);
  const familyValues = inspector(page).locator(".financial-review-chart-family-value");
  await expect(familyValues).toHaveCount(3);
  await expect(familyValues.first()).toHaveAttribute("data-family-id", "sponsored-products");
  await expect(familyValues.first().locator("dd")).toHaveText(["5.00", "-0.01"]);
  await page.mouse.move(0, 0);
  await chart(page)
    .getByRole("button", { name: "Jan: View chart details for January 2026", exact: true })
    .focus();
  await expect(selection).toHaveValue("2026-01");
  await expect(totals).toHaveText(["-11.01", "-11.01"]);
  await selection.selectOption("2026-02");
  await expect(totals).toHaveText(["3.99", "-7.01"]);
  const open = inspector(page).getByRole("button", { name: "Open month details", exact: true });
  await open.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(drawer.getByRole("heading", { name: "February 2026", exact: true })).toBeVisible();
  await drawer
    .getByRole("button", { name: "Close monthly financial review", exact: true })
    .press("Enter");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await expect(chart(page).locator(".financial-review-axis-currency")).toHaveText("USD");
  await expect(chart(page).locator(".financial-review-axis-label")).toHaveCount(3);
  await expect(
    chart(page).locator(".financial-review-axis-label[title='-20.01 USD']"),
  ).toBeVisible();
});

test("a long phone legend stays below the plot and expands without removing plotted families", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openFinancialReview(page, (fixture) => setupFamilies(fixture, { extraFamilies: 18 }));
  const legend = chart(page).getByRole("list", { name: "Type family legend", exact: true });
  await expect(legend.locator("li")).toHaveCount(6);
  await expect(chart(page)).toContainText(
    "Showing 6 of 23 families, comparable scopes first. All 23 are plotted.",
  );
  await expect(legend.locator("li").first()).toHaveAttribute("data-family-id", "monthly-storage");
  expect((await chart(page).locator(".financial-review-trend-plot").boundingBox()).y).toBeLessThan(
    (await legend.boundingBox()).y,
  );
  expect((await legend.boundingBox()).height).toBeLessThan(240);
  const plotted = () =>
    chart(page)
      .locator(".financial-review-family-line")
      .evaluateAll((lines) => new Set(lines.map((line) => line.dataset.familyId)).size);
  expect(await plotted()).toBe(23);
  await chart(page)
    .getByRole("button", { name: "Show all 23 families", exact: true })
    .press("Enter");
  await expect(legend.locator("li")).toHaveCount(23);
  await chart(page)
    .getByRole("button", { name: "Show fewer families", exact: true })
    .press("Enter");
  await expect(legend.locator("li")).toHaveCount(6);
  expect(await plotted()).toBe(23);
  await expect(inspector(page).locator(".financial-review-chart-family-value")).toHaveCount(3);
  await expect(inspector(page).locator(".financial-review-chart-family-value:visible")).toHaveCount(
    1,
  );
  await inspector(page)
    .getByRole("button", { name: "Show all 23 family values", exact: true })
    .press("Enter");
  await expect(inspector(page).locator(".financial-review-chart-family-value")).toHaveCount(23);
  await expect(
    inspector(page).getByRole("group", { name: "Family chart values", exact: true }),
  ).toHaveAttribute("tabindex", "0");
  const expandedValues = inspector(page).getByRole("group", {
    name: "Family chart values",
    exact: true,
  });
  await expandedValues.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => expandedValues.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await inspector(page)
    .getByRole("button", { name: "Show fewer family values", exact: true })
    .press("Enter");
  await expect(inspector(page).locator(".financial-review-chart-family-value")).toHaveCount(3);
  await expect(inspector(page).locator(".financial-review-chart-family-value:visible")).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible("chart-inspection-phone");
  await chart(page).screenshot({
    path: testInfo.outputPath("compact-chart-inspection-phone.png"),
    animations: "disabled",
  });
});
