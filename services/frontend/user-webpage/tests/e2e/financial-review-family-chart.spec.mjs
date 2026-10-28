import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import {
  chooseFamilies,
  clearFamilies,
  familyMenu,
  familyTrigger,
} from "./financial-review-family-actions.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";

const chart = (page) =>
  page.getByRole("figure", { name: "Monthly and running differences", exact: true });
const legend = (page) => chart(page).getByRole("list", { name: "Fee family legend", exact: true });
const month = (page, abbreviation, name) =>
  chart(page).getByRole("button", {
    name: `${abbreviation}: View chart details for ${name}`,
    exact: true,
  });
const segment = (point, id) => point.locator(`.financial-review-trend-bar[data-family-id="${id}"]`);

async function seriesIds(locator) {
  return locator.evaluateAll((elements) =>
    [...new Set(elements.map((element) => element.dataset.familyId))].sort(),
  );
}

test("family bars stack positive and negative differences separately and describe exact running values", async ({
  page,
}, testInfo) => {
  await openFinancialReview(page, (fixture) => setupFamilies(fixture, { offsettingMarch: true }));
  const february = month(page, "Feb", "February 2026");
  await expect(legend(page).getByText("Monthly storage", { exact: true })).toBeVisible();
  await expect(february).toHaveAttribute(
    "title",
    /^February 2026: Monthly difference 3\.99 USD; Running difference -7\.01 USD(?:\n|$)/,
  );
  for (const description of [
    "Monthly storage: Monthly difference -3.00 USD; Running difference -5.01 USD",
    "Aged storage: Monthly difference 2.00 USD; Running difference 0.00 USD",
    "Sponsored products: Monthly difference 5.00 USD; Running difference -0.01 USD",
    "Future fee · Finances (Finances only): Monthly difference 0.00 USD; Running difference -11.00 USD",
    "Future fee · Data Kiosk (Data Kiosk only): Monthly difference 0.00 USD; Running difference 9.00 USD",
  ])
    await expect.poll(() => february.getAttribute("title")).toContain(description);
  await expect(month(page, "Mar", "March 2026")).toHaveAttribute(
    "title",
    /^March 2026: Monthly difference 0\.00 USD; Running difference -7\.01 USD(?:\n|$)/,
  );

  const zero = await chart(page).locator(".financial-review-zero-line").boundingBox();
  const negative = await segment(february, "monthly-storage").boundingBox();
  const positives = await Promise.all(
    ["aged-storage", "sponsored-products"].map((id) => segment(february, id).boundingBox()),
  );
  expect(negative.height).toBeGreaterThan(0);
  expect(Math.abs(negative.y - zero.y)).toBeLessThanOrEqual(1);
  for (const positive of positives) {
    expect(positive.height).toBeGreaterThan(0);
    expect(positive.y + positive.height).toBeLessThanOrEqual(zero.y + 1);
  }
  positives.sort((left, right) => left.y - right.y);
  expect(Math.abs(positives[0].y + positives[0].height - positives[1].y)).toBeLessThanOrEqual(1);
  expect(Math.abs(positives[1].y + positives[1].height - zero.y)).toBeLessThanOrEqual(1);

  const march = month(page, "Mar", "March 2026");
  const offsettingPositive = await segment(march, "monthly-storage").boundingBox();
  const offsettingNegative = await segment(march, "sponsored-products").boundingBox();
  expect(offsettingPositive.height).toBeGreaterThan(0);
  expect(offsettingNegative.height).toBeGreaterThan(0);
  expect(Math.abs(offsettingPositive.y + offsettingPositive.height - zero.y)).toBeLessThanOrEqual(
    1,
  );
  expect(Math.abs(offsettingNegative.y - zero.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(offsettingPositive.height - offsettingNegative.height)).toBeLessThanOrEqual(1);

  const lines = chart(page).locator(".financial-review-family-line[data-family-id]");
  await expect
    .poll(() => seriesIds(lines))
    .toEqual([
      "aged-storage",
      "monthly-storage",
      "source:DATA_KIOSK:FUTURE_FEE",
      "source:FINANCES:FUTURE_FEE",
      "sponsored-products",
    ]);
  for (const line of await lines.all()) {
    const opacity = await line.evaluate((element) =>
      Number(globalThis.getComputedStyle(element).opacity),
    );
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  }
  await page.screenshot({
    path: testInfo.outputPath("family-stacks-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await february.press("Enter");
  const detail = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(detail.getByRole("heading", { name: "February 2026", exact: true })).toBeVisible();
  await detail.press("Escape");
  await expect(detail).toBeHidden();
  await expect(february).toBeFocused();
});

test("family colors and legend identities remain stable when selecting and clearing chart series", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  const february = month(page, "Feb", "February 2026");
  const ids = ["aged-storage", "monthly-storage", "sponsored-products"];
  const colors = new Map();
  for (const id of ids) {
    await expect(segment(february, id)).toBeVisible();
    colors.set(
      id,
      await segment(february, id).evaluate(
        (element) => globalThis.getComputedStyle(element).backgroundColor,
      ),
    );
  }
  expect(new Set(colors.values()).size).toBe(3);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  await expect
    .poll(() => seriesIds(legend(page).locator("[data-family-id]")))
    .toEqual(["monthly-storage", "sponsored-products"]);
  await expect
    .poll(() => seriesIds(chart(page).locator(".financial-review-family-line[data-family-id]")))
    .toEqual(["monthly-storage", "sponsored-products"]);
  await expect(segment(february, "aged-storage")).toHaveCount(0);
  for (const id of ["monthly-storage", "sponsored-products"])
    await expect(segment(february, id)).toHaveCSS("background-color", colors.get(id));
  await expect(february).toHaveAttribute(
    "title",
    /^February 2026: Monthly difference 1\.99 USD; Running difference -5\.01 USD(?:\n|$)/,
  );
  await expect.poll(() => february.getAttribute("title")).not.toContain("Aged storage:");
  await clearFamilies(page);
  for (const id of ids)
    await expect(segment(february, id)).toHaveCSS("background-color", colors.get(id));
  await expect(legend(page).getByText("Aged storage", { exact: true })).toBeVisible();
});

test("phone family checkboxes search and clear with the standard keyboard flow", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openFinancialReview(page, (fixture) => setupFamilies(fixture, { extraFamilies: 5 }));
  const trigger = familyTrigger(page);
  await trigger.press("Enter");
  const menu = familyMenu(page);
  const search = menu.getByRole("textbox", { name: "Search fee families", exact: true });
  await expect(search).toBeFocused();
  await search.fill("storage");
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await menu.getByRole("checkbox", { name: "Monthly storage", exact: true }).press("Space");
  await search.fill("products");
  await expect(menu.getByRole("checkbox")).toHaveCount(1);
  await menu.getByRole("checkbox", { name: "Sponsored products", exact: true }).press("Space");
  await menu.getByRole("button", { name: "Clear option search", exact: true }).press("Enter");
  await expect(search).toBeFocused();
  await expect(menu.getByRole("checkbox")).toHaveCount(10);
  await expect(menu.getByRole("checkbox", { name: "Monthly storage", exact: true })).toBeChecked();
  await expect(
    menu.getByRole("checkbox", { name: "Sponsored products", exact: true }),
  ).toBeChecked();
  await expect(menu.getByText("2 selected", { exact: true })).toBeVisible();
  await expectFullyInViewport(menu.getByRole("button", { name: "Done", exact: true }));
  await expectAccessible("family-checkbox-search-phone");
  await page.screenshot({
    path: testInfo.outputPath("family-checkbox-search-phone.png"),
    animations: "disabled",
  });
  await menu.getByRole("button", { name: "Clear fee families", exact: true }).press("Enter");
  await expect(search).toBeFocused();
  await expect(menu.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Done", exact: true }).press("Enter");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    )
    .toBe(true);
  await expectAccessible("family-chart-phone");
});

test("inconsistent family aggregates keep total values visible until a coordinated retry recovers", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, (state) => {
    setupFamilies(state);
    state.financialReviewTypeTotals.find(
      (row) =>
        row.month === "2026-02-01" &&
        row.currency === "USD" &&
        row.component_type === "STORAGE_FEES",
    ).amount = "-40.004";
  });
  const figure = chart(page);
  const february = month(page, "Feb", "February 2026");
  await expect(figure).toContainText(
    "Fee-family details do not match the current totals. Showing total differences.",
  );
  await expect(february).toHaveAttribute(
    "title",
    /^February 2026: Monthly difference 3\.99 USD; Running difference -7\.01 USD(?:\n|$)/,
  );
  await expect(figure.locator(".financial-review-trend-bar[data-family-id]")).toHaveCount(0);
  await expect(figure.locator(".financial-review-family-line[data-family-id]")).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);
  fixture.financialReviewTypeTotals.find(
    (row) =>
      row.month === "2026-02-01" && row.currency === "USD" && row.component_type === "STORAGE_FEES",
  ).amount = "-4.004";
  const before = fixture.financialReviewRequests.length;
  await figure.getByRole("button", { name: "Retry family chart", exact: true }).press("Enter");
  await expect(figure).toBeFocused();
  await expect(legend(page).getByText("Monthly storage", { exact: true })).toBeVisible();
  await expect(figure.getByRole("button", { name: "Retry family chart", exact: true })).toHaveCount(
    0,
  );
  await expect(february).toHaveAttribute(
    "title",
    /^February 2026: Monthly difference 3\.99 USD; Running difference -7\.01 USD(?:\n|$)/,
  );
  const refreshed = fixture.financialReviewRequests
    .slice(before)
    .filter(
      ({ params }) =>
        params.get("p_month_from") === "2026-01-01" && params.get("p_month_to") === "2027-01-01",
    );
  expect(new Set(refreshed.map(({ endpoint }) => endpoint))).toEqual(
    new Set(["financial_review_totals", "financial_review_type_totals"]),
  );
});
