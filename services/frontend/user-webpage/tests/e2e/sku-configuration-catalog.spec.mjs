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

test("large catalogs preserve global setup diagnostics without blocking unrelated valid changes", async ({
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
  const fixture = await setup(page, "administrator", [item("S1"), ...missing]);
  await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
    "of 1,206 SKUs",
  );
  await stageRate(page);
  await openReview(page);
  await expect(review(page).getByRole("button", { name: /^Complete / })).toHaveCount(0);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Needs setup only", exact: true }).check();
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
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeEnabled();
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect.poll(() => fixture.configurationSaves.length).toBe(1);
  expect(fixture.configurationSaves[0].p_changes.map(({ sku }) => sku).sort()).toEqual([
    "S1",
    "UNASSIGNED-1204",
  ]);
  await expect(page.getByText("1204 SKUs need setup", { exact: true })).toBeVisible();
});
