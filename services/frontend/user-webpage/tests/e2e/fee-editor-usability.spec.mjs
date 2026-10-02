import { expect, test } from "@playwright/test";
import {
  COMPANY,
  editor,
  item,
  openEditor,
  openReview,
  period,
  review,
  setup,
  stageRate,
  version,
} from "./sku-configuration-fixtures.mjs";

test("Add SKU suggests literal case-insensitive prefixes and opens existing drafts explicitly", async ({
  page,
}) => {
  const fixture = await setup(
    page,
    "operator",
    ["S1", "ABC-one", "abc-Two", "xABC-middle", "[literal]-sku", " literal SKU "].map(
      (sku, index) =>
        item(sku, { sku_id: version(index + 1), terms_version_id: version(index + 11) }),
    ),
  );
  await stageRate(page, "6.123456");
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  const sku = editor(page).getByRole("combobox", { name: "SKU", exact: true });
  await sku.fill("AbC");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["ABC-one", "abc-Two"]);
  await sku.fill("[");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["[literal]-sku"]);
  await sku.fill(" literal");
  await page.getByRole("listbox").getByRole("option").click();
  await expect(sku).toHaveValue(" literal SKU ");
  await expect(
    editor(page).getByRole("button", { name: "Keep draft", exact: true }),
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "Edit existing SKU", exact: true }).click();
  await expect(editor(page)).toHaveAccessibleName("Edit literal SKU");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByRole("combobox", { name: "SKU", exact: true }).fill("s");
  await page.getByRole("listbox").getByRole("option", { name: "S1", exact: true }).click();
  await editor(page).getByRole("button", { name: "Edit existing SKU", exact: true }).click();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.123456");
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("new SKU spelling and whitespace stay exact through autocomplete, reload, and review", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  const sku = editor(page).getByRole("combobox", { name: "SKU", exact: true });
  await sku.fill(" Brand NEW ");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0);
  await editor(page).getByLabel("Company", { exact: true }).selectOption(COMPANY);
  await page.reload();
  await expect(editor(page).getByRole("combobox", { name: "SKU", exact: true })).toHaveValue(
    " Brand NEW ",
  );
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect.poll(() => fixture.configurationSaves.length).toBe(1);
  expect(fixture.configurationSaves[0].p_changes[0].sku).toBe(" Brand NEW ");
});

test("period editing keeps desktop actions visible, focuses added periods, and survives reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const periods = Array.from({ length: 9 }, (_, index) =>
    period(
      String(index),
      `2026-09-${String(index + 1).padStart(2, "0")}`,
      `2026-09-${String(index + 2).padStart(2, "0")}`,
    ),
  );
  const fixture = await setup(page, "operator", [item("S1", { periods })]);
  await openEditor(page);
  const keep = editor(page).getByRole("button", { name: "Keep draft", exact: true });
  await expect(keep).toBeInViewport();
  const firstFields = await Promise.all(
    ["Marketplace 1", "Fee rate 1 (%)", "Start date 1 (inclusive)", "End date 1 (exclusive)"].map(
      (label) => editor(page).getByLabel(label, { exact: true }).boundingBox(),
    ),
  );
  expect(new Set(firstFields.map((bounds) => Math.round(bounds.y))).size).toBe(1);
  const before = await keep.boundingBox();
  await page.screenshot({
    path: testInfo.outputPath("desktop-period-editor.png"),
    animations: "disabled",
  });
  await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await expect(editor(page).getByLabel("Marketplace 10", { exact: true })).toBeFocused();
  await expect(keep).toBeInViewport();
  expect(Math.abs((await keep.boundingBox()).y - before.y)).toBeLessThan(1);
  await editor(page).getByLabel("Fee rate 10 (%)", { exact: true }).fill("6.123456");
  await page.reload();
  await expect(editor(page).getByLabel("Fee rate 10 (%)", { exact: true })).toHaveValue("6.123456");
  await expect(keep).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(keep).toBeInViewport();
  expect(await editor(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await editor(page).getByLabel("Fee rate 10 (%)", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("mobile-period-editor.png"),
    animations: "disabled",
  });
  await keep.click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  expect(fixture.configurationSaves).toHaveLength(0);
});
