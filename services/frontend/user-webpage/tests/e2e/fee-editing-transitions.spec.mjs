import { expect, test } from "@playwright/test";
import {
  setup,
  item,
  period,
  editor,
  review,
  openEditor,
  openReview,
} from "./sku-configuration-fixtures.mjs";

const rateChange = (page) =>
  editor(page).getByRole("region", { name: "Change rate from date", exact: true });

test("starting a guided rate change again cannot replace unfinished input", async ({ page }) => {
  await setup(page, "administrator", [
    item("S1", { periods: [period("5", "2026-09-01", "2026-09-10"), period("7", "2026-09-10")] }),
  ]);
  await openEditor(page);
  const first = editor(page).getByRole("button", {
    name: "Change rate from date for period 1",
    exact: true,
  });
  const second = editor(page).getByRole("button", {
    name: "Change rate from date for period 2",
    exact: true,
  });
  await first.click();
  const helper = rateChange(page);
  await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.25");
  await first.press("Enter");
  await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.25");
  await expect(first).toBeDisabled();
  await expect(second).toBeDisabled();
  await helper.getByRole("button", { name: "Cancel rate change", exact: true }).click();
  await expect(first).toBeEnabled();
  await expect(second).toBeEnabled();
});

test("editing another period keeps the unfinished guided rate change through reload", async ({
  page,
}) => {
  const fixture = await setup(page, "administrator", [
    item("S1", { periods: [period("5", "2026-09-01", "2026-09-10"), period("7", "2026-09-10")] }),
  ]);
  await openEditor(page);
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const helper = rateChange(page);
  await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
  await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.25");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await editor(page).getByLabel("Fee rate 2 (%)", { exact: true }).fill("8");
  await expect(helper).toBeVisible();
  await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.25");
  await expect(
    helper.getByRole("button", { name: "Preview rate change", exact: true }),
  ).toBeVisible();
  await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await expect(helper.getByLabel("New rate effective date", { exact: true })).toHaveValue(
    "2026-09-02",
  );
  await editor(page).getByRole("button", { name: "Close SKU editor", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Resume unfinished edit", exact: true }).click();
  await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.25");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await helper.getByRole("button", { name: "Use rate change in draft", exact: true }).click();
  await expect(editor(page).getByLabel("Fee rate 2 (%)", { exact: true })).toHaveValue("6.25");
  await expect(editor(page).getByLabel("Fee rate 3 (%)", { exact: true })).toHaveValue("8");
  await expect(editor(page).getByLabel("Fee rate 4 (%)", { exact: true })).toHaveValue("");
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("discarding reviewed drafts preserves a useful keyboard position", async ({ page }) => {
  const fixture = await setup(page, "administrator", [item("S1"), item("S2")]);
  for (const sku of ["S1", "S2"]) {
    await openEditor(page, sku);
    await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
    await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  }
  await openReview(page);
  const discardFirst = review(page).getByRole("button", {
    name: "Discard draft for S1",
    exact: true,
  });
  await discardFirst.focus();
  await discardFirst.press("Enter");
  await expect(review(page).getByRole("button", { name: "Edit S2", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    review(page).getByRole("button", { name: "Discard draft for S2", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    review(page).getByRole("button", { name: "Back to editing", exact: true }),
  ).toBeFocused();
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  expect(fixture.configurationSaves).toHaveLength(0);
});

for (const removedPeriod of [1, 3]) {
  test(`removing period ${removedPeriod} preserves a guided change on a different period`, async ({
    page,
  }) => {
    await setup(page, "administrator", [
      item("S1", {
        periods: [
          period("5", "2026-09-01", "2026-09-05"),
          period("7", "2026-09-05", "2026-09-10"),
          period("9", "2026-09-10"),
        ],
      }),
    ]);
    await openEditor(page);
    await editor(page)
      .getByRole("button", { name: "Change rate from date for period 2", exact: true })
      .click();
    const helper = rateChange(page);
    await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-06");
    await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.75");
    await editor(page)
      .getByRole("button", { name: `Remove period ${removedPeriod}`, exact: true })
      .click();
    await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.75");
    await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
    await helper.getByRole("button", { name: "Use rate change in draft", exact: true }).click();
    const source = removedPeriod === 1 ? 1 : 2;
    await expect(editor(page).getByLabel(`Fee rate ${source} (%)`, { exact: true })).toHaveValue(
      "7",
    );
    await expect(
      editor(page).getByLabel(`End date ${source} (exclusive)`, { exact: true }),
    ).toHaveValue("2026-09-06");
    await expect(
      editor(page).getByLabel(`Fee rate ${source + 1} (%)`, { exact: true }),
    ).toHaveValue("6.75");
  });
}

test("editing the guided change's source invalidates its preview without clearing the new rate", async ({
  page,
}) => {
  await setup(page);
  await openEditor(page);
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const helper = rateChange(page);
  await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-06");
  await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.75");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await editor(page).getByLabel("Start date 1 (inclusive)", { exact: true }).fill("2026-09-07");
  await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.75");
  await expect(
    helper.getByRole("button", { name: "Use rate change in draft", exact: true }),
  ).toHaveCount(0);
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await expect(
    helper.getByText("Choose a date within this period. Its end date is exclusive.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(helper.getByLabel("New rate effective date", { exact: true })).toBeFocused();
  await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-08");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await helper.getByRole("button", { name: "Use rate change in draft", exact: true }).click();
  await expect(editor(page).getByLabel("Start date 2 (inclusive)", { exact: true })).toHaveValue(
    "2026-09-08",
  );
});
