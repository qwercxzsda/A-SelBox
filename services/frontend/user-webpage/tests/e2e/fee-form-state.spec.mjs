import { expect, test } from "@playwright/test";
import {
  OTHER_COMPANY,
  setup,
  item,
  period,
  version,
  editor,
  review,
  openEditor,
  openReview,
  stageRate,
} from "./sku-configuration-fixtures.mjs";

test("changing company retains a ready rate preview and both edits survive reload", async ({
  page,
}) => {
  const fixture = await setup(page);
  await openEditor(page);
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const helper = editor(page).getByRole("region", { name: "Change rate from date", exact: true });
  await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
  await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.123456");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await editor(page).getByLabel("Company", { exact: true }).selectOption(OTHER_COMPANY);
  await expect(
    helper.getByRole("button", { name: "Use rate change in draft", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(editor(page).getByLabel("Company", { exact: true })).toHaveValue(OTHER_COMPANY);
  await helper.getByRole("button", { name: "Use rate change in draft", exact: true }).click();
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  expect(fixture.configurationSaves[0].p_changes).toEqual([
    {
      sku: "S1",
      company_id: OTHER_COMPANY,
      expected_current_version_id: version(11),
      periods: [period("5", "2026-09-01", "2026-09-02"), period("6.123456", "2026-09-02")],
    },
  ]);
});

test("loading latest settings replaces every live field and checkpoints the new version", async ({
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
  const latestPeriods = [period("8", "2026-09-01", "2026-09-03"), period("9", "2026-09-03")];
  fixture.skuConfigurationItems[0] = item("S1", {
    company_id: OTHER_COMPANY,
    terms_version_id: version(21),
    periods: latestPeriods,
  });
  await page.getByRole("button", { name: "Refresh saved settings", exact: true }).click();
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6");
  await editor(page)
    .getByRole("button", { name: "Load latest saved settings", exact: true })
    .click();
  await expect(editor(page).getByLabel("Company", { exact: true })).toHaveValue(OTHER_COMPANY);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("8");
  await expect(editor(page).getByLabel("End date 1 (exclusive)", { exact: true })).toHaveValue(
    "2026-09-03",
  );
  await expect(editor(page).getByLabel("Start date 2 (inclusive)", { exact: true })).toHaveValue(
    "2026-09-03",
  );
  await expect(editor(page).getByLabel("End date 2 (exclusive)", { exact: true })).toHaveValue("");
  await editor(page).getByLabel("Fee rate 2 (%)", { exact: true }).fill("9.25");
  await page.reload();
  await expect(editor(page).getByLabel("Fee rate 2 (%)", { exact: true })).toHaveValue("9.25");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  fixture.configurationSaveStatus = 200;
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  expect(fixture.configurationSaves[1].p_changes).toEqual([
    {
      sku: "S1",
      company_id: OTHER_COMPANY,
      expected_current_version_id: version(21),
      periods: [latestPeriods[0], period("9.25", "2026-09-03")],
    },
  ]);
});
