import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import {
  COMPANY,
  OTHER_COMPANY,
  version,
  period,
  item,
  editor,
  review,
  setup,
  openEditor,
  stageRate,
  openReview,
} from "./sku-configuration-fixtures.mjs";

test("administrators stage multiple SKUs and cannot save until every known SKU is complete", async ({
  page,
}, testInfo) => {
  const fixture = await setup(page, "operator", [
    item("S1"),
    item("S2", { company_id: null, periods: [period("0", "2026-09-01", "2026-09-02")] }),
  ]);
  await stageRate(page, "6.123456");
  expect(fixture.configurationSaves).toHaveLength(0);
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  await review(page).getByRole("button", { name: "Complete S2", exact: true }).click();
  await expect(editor(page).getByLabel("Fee rate 2 (%)", { exact: true })).toHaveValue("");
  await expect(editor(page).getByLabel("Start date 2 (inclusive)", { exact: true })).toHaveValue(
    "2026-09-02",
  );
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await editor(page).getByLabel("Fee rate 2 (%)", { exact: true }).fill("7.123456");
  await page.screenshot({
    path: testInfo.outputPath("desktop-editor.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("mobile-editor.png"), animations: "disabled" });
  expect(await editor(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByText("2 SKU drafts · not saved yet", { exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
  await openReview(page);
  await review(page).getByLabel("Reason for changes (optional)").fill("Complete September fees");
  await expect(review(page).getByRole("cell", { name: "6.123456%", exact: true })).toBeVisible();
  await expect(review(page).getByRole("cell", { name: "7.123456%", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("desktop-review.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("mobile-review.png"), animations: "disabled" });
  await review(page)
    .getByRole("button", { name: "Save all changes", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("mobile-review-bottom.png"),
    animations: "disabled",
  });
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 SKU changes saved." })).toBeVisible();
  await expect(page.getByText("No unsaved changes.", { exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(1);
  expect(fixture.configurationSaves[0].p_changes.map((change) => change.sku)).toEqual(["S1", "S2"]);
  expect(
    fixture.configurationSaves[0].p_changes[1].periods.map((row) => row.fee_rate_percent),
  ).toEqual(["0", "7.123456"]);
  expect(fixture.configurationSaves[0].p_change_reason).toBe("Complete September fees");
});

test("members see only their assigned settings and have no edit or save controls", async ({
  page,
}) => {
  const fixture = await setup(page, "company_member", [
    item("S1"),
    item("S2", { company_id: OTHER_COMPANY }),
  ]);
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for S2", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show marketplace fees for S1", exact: true }).click();
  await expect(page.getByRole("cell", { name: "5%", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add SKU|Edit S1|Review changes|Save all changes/ }),
  ).toHaveCount(0);
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("invalid draft fields are kept with inline errors and block the global save", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page, "100.000001");
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  await review(page).getByRole("button", { name: "Edit S1", exact: true }).click();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue(
    "100.000001",
  );
  await expect(
    editor(page).getByText("Enter a fee from 0 to 100 with up to 6 decimal places.", {
      exact: true,
    }),
  ).toBeVisible();
  const invalidRate = editor(page).getByLabel("Fee rate 1 (%)", { exact: true });
  const errorBorder = await invalidRate.evaluate(
    (element) => globalThis.getComputedStyle(element).borderTopColor,
  );
  const ordinaryBorder = await editor(page)
    .getByLabel("Start date 1 (inclusive)", { exact: true })
    .evaluate((element) => globalThis.getComputedStyle(element).borderTopColor);
  expect(errorBorder).not.toBe(ordinaryBorder);
  await invalidRate.focus();
  await expect(invalidRate).toHaveCSS("border-top-color", errorBorder);
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("conflicts keep drafts and require explicit review of the latest saved settings", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page, "6");
  fixture.configurationSaveStatus = 409;
  fixture.configurationSaveError = {
    code: "PT409",
    message: "SKU configuration changed while editing",
  };
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "A SKU changed while you were editing" }),
  ).toBeVisible();
  fixture.skuConfigurationItems[0] = item("S1", {
    terms_version_id: version(21),
    periods: [period("9")],
  });
  await page.getByRole("button", { name: "Refresh saved settings", exact: true }).click();
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6");
  await editor(page)
    .getByRole("button", { name: "Load latest saved settings", exact: true })
    .click();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("9");
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("7");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  fixture.configurationSaveStatus = 200;
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(2);
  expect(fixture.configurationSaves[1].p_changes[0].expected_current_version_id).toBe(version(21));
});

test("an unconfirmed save blocks re-saving across tab navigation until saved data is reloaded", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page);
  fixture.configurationSaveStatus = 503;
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "We could not confirm the save" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  await review(page).getByRole("button", { name: "Back to editing", exact: true }).click();
  expect(fixture.configurationSaves).toHaveLength(1);
  fixture.configurationSaveStatus = 200;
  await page.getByRole("button", { name: "Refresh saved settings", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeEnabled();
});

test("newly imported missing ownership returned by the server preserves all prepared changes", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page);
  const missing = item("S2", {
    sku_id: null,
    company_id: null,
    terms_version_id: null,
    periods: [],
    requirements: [],
  });
  fixture.skuConfigurationItems.push(missing);
  fixture.configurationSaveStatus = 409;
  fixture.configurationSaveError = {
    code: "23514",
    message: "SKU configuration is incomplete",
    details: JSON.stringify({
      issues: [
        {
          sku: "S2",
          kind: "missing_company",
          marketplace_name: null,
          valid_from: null,
          valid_to: null,
        },
      ],
    }),
  };
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No changes were saved." })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for S2", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 SKU draft · not saved yet", { exact: true })).toBeVisible();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
});

test("a confirmed save remains successful when refreshing the displayed configuration fails", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page);
  fixture.beforeConfigurationSave = async () => {
    fixture.configurationStatus = 503;
  };
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  await expect(
    page.getByText("Your changes were saved, but the displayed settings could not be refreshed.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.configurationSaves).toHaveLength(1);
});

test("administrators can prepare a new exact SKU with company ownership before imports exist", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByLabel("SKU", { exact: true }).fill(" New SKU ");
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  expect(fixture.configurationSaves).toHaveLength(0);
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  expect(fixture.configurationSaves[0].p_changes[0].sku).toBe(" New SKU ");
  expect(fixture.configurationSaves[0].p_changes[0].periods).toEqual([]);
});

test("a pending save remains exclusive after the fee screen unmounts and remounts", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page);
  const pending = deferred();
  fixture.beforeConfigurationSave = () => pending.promise;
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect.poll(() => fixture.configurationSaves.length).toBe(1);
  await expect(
    review(page).getByRole("button", { name: "Discard draft for S1", exact: true }),
  ).toBeDisabled();
  // Exercise remounting even while the review overlay prevents normal navigation.
  await page
    .getByRole("tab", { name: "Transactions", exact: true })
    .evaluate((element) => element.click());
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Edit S1", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add SKU", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Review changes/ })).toBeDisabled();
  await expect(page.getByText("1 SKU draft · not saved yet", { exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(1);
  pending.resolve();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  await expect(page.getByText("No unsaved changes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit S1", exact: true })).toBeEnabled();
  expect(fixture.configurationSaves).toHaveLength(1);
});

test("discarding an accidental new SKU in review preserves other drafts without writing", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page, "6.123456");
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByLabel("SKU", { exact: true }).fill("TYPO-SKU");
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await review(page)
    .getByRole("button", { name: "Discard draft for TYPO-SKU", exact: true })
    .click();
  await expect(review(page).getByText("TYPO-SKU", { exact: true })).toHaveCount(0);
  await expect(review(page).getByRole("cell", { name: "6.123456%", exact: true })).toBeVisible();
  await review(page).getByRole("button", { name: "Back to editing", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for TYPO-SKU", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("1 SKU draft · not saved yet", { exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
});
