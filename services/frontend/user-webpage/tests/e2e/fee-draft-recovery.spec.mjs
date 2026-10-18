import { expect, test } from "@playwright/test";
import {
  COMPANY,
  setup,
  item,
  period,
  editor,
  review,
  openEditor,
  openReview,
  version,
} from "./sku-configuration-fixtures.mjs";

for (const close of ["button", "Escape", "backdrop"]) {
  test(`unfinished fee edits survive ${close}, reload, and resume without becoming staged changes`, async ({
    page,
  }) => {
    const fixture = await setup(page);
    const opener = page.getByRole("button", { name: "Edit S1", exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");
    await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("1.234567");
    if (close === "button")
      await editor(page).getByRole("button", { name: "Close SKU editor" }).click();
    else if (close === "Escape") await page.keyboard.press("Escape");
    else await page.mouse.click(5, 400);
    await expect(editor(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByRole("button", { name: /^Review changes/ })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Fee changes" })).toContainText(
      "1 unfinished edit",
    );
    await page.reload();
    await page.getByRole("button", { name: "Resume unfinished edit", exact: true }).click();
    await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue(
      "1.234567",
    );
    await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
    await openReview(page);
    await expect(review(page)).toContainText("5% → 1.234567%");
    expect(fixture.configurationSaves).toHaveLength(0);
  });
}

test("explicitly discarding an unfinished edit retains its earlier staged version", async ({
  page,
}) => {
  await setup(page);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("7");
  await editor(page).getByRole("button", { name: "Close SKU editor" }).click();
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("7");
  await editor(page).getByRole("button", { name: "Discard edits", exact: true }).click();
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6");
});

test("an unnamed new SKU keeps incomplete company and period inputs through close and reload", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("5.123456");
  await editor(page).getByRole("button", { name: "Close SKU editor" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await expect(editor(page).getByRole("combobox", { name: "SKU", exact: true })).toHaveValue("");
  await expect(editor(page).getByLabel("Company", { exact: true })).toHaveValue(COMPANY);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("5.123456");
  expect(fixture.configurationSaves).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`guided rate changes preview the exact boundary before staging and saving at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page);
    await openEditor(page);
    await editor(page)
      .getByRole("button", { name: "Change rate from date for period 1", exact: true })
      .click();
    const helper = editor(page).getByRole("region", { name: "Change rate from date", exact: true });
    await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
    await helper.getByLabel("New fee rate (%)", { exact: true }).fill("6.123456");
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeVisible();
    await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
    await expect(helper).toContainText(
      "The previous rate ends exclusively on the new rate's inclusive start date",
    );
    await expect(
      editor(page).getByRole("button", { name: "Keep draft", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(helper.getByLabel("New fee rate (%)", { exact: true })).toHaveValue("6.123456");
    await editor(page).getByRole("button", { name: "Close SKU editor" }).click();
    await page.getByRole("button", { name: "Resume unfinished edit", exact: true }).click();
    await expect(
      helper.getByRole("button", { name: "Use rate change in draft", exact: true }),
    ).toBeVisible();
    expect(await editor(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`rate-preview-${width}.png`),
      animations: "disabled",
    });
    expect(fixture.configurationSaves).toHaveLength(0);
    await helper.getByRole("button", { name: "Use rate change in draft", exact: true }).click();
    await expect(editor(page).getByLabel("End date 1 (exclusive)", { exact: true })).toHaveValue(
      "2026-09-02",
    );
    await expect(editor(page).getByLabel("Start date 2 (inclusive)", { exact: true })).toHaveValue(
      "2026-09-02",
    );
    await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
    await openReview(page);
    expect(fixture.configurationSaves).toHaveLength(0);
    await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
    await expect.poll(() => fixture.configurationSaves.length).toBe(1);
    expect(fixture.configurationSaves[0].p_changes[0].periods).toEqual([
      period("5", "2026-09-01", "2026-09-02"),
      period("6.123456", "2026-09-02"),
    ]);
  });
}

test("Review changes remains reachable after editing a SKU lower in a long page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, "administrator", [
    item("S1"),
    ...Array.from({ length: 20 }, (_, i) =>
      item(`Z-${String(i).padStart(2, "0")}`, { sku_id: version(100 + i) }),
    ),
  ]);
  await openEditor(page, "Z-19");
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Review changes/ })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Edit Z-19", exact: true })).toBeFocused();
});
