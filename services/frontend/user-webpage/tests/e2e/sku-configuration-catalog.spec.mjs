import { expect, test } from "@playwright/test";
import {
  COMPANY,
  setup,
  item,
  stageRate,
  openReview,
  review,
  editor,
} from "./sku-configuration-fixtures.mjs";

test("large catalogs keep review bounded while every off-page SKU still blocks publication", async ({
  page,
}) => {
  const missing = Array.from({ length: 1205 }, (_, index) =>
    item(`UNASSIGNED-${String(index).padStart(4, "0")}`, {
      sku_id: null,
      terms_version_id: null,
      company_id: null,
      periods: [],
      requirements: [],
    }),
  );
  const fixture = await setup(page, "operator", [item("S1"), ...missing]);
  await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
    "of 1,206 SKUs",
  );
  await stageRate(page);
  await openReview(page);
  await expect(review(page).getByRole("button", { name: /^Complete / })).toHaveCount(5);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  await review(page)
    .getByRole("button", { name: "View all 1205 SKUs needing setup", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: "Needs setup only", exact: true })).toBeChecked();
  await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
    "of 1,205 SKUs",
  );
  await page.getByLabel("Search SKUs", { exact: true }).fill("UNASSIGNED-1204");
  await page
    .getByRole("button", { name: "Show marketplace fees for UNASSIGNED-1204", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit UNASSIGNED-1204", exact: true }).click();
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "View all 1204 SKUs needing setup", exact: true }),
  ).toBeVisible();
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  expect(fixture.configurationSaves).toHaveLength(0);
});
