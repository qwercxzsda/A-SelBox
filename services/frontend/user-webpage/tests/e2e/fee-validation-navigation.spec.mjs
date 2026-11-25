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

test("completing a reviewed SKU focuses its invalid fee field deep in the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const fixture = await setup(page, "administrator", [
    item("S1", {
      periods: Array.from({ length: 18 }, (_, index) =>
        period(
          "5",
          `2026-09-${String(index + 1).padStart(2, "0")}`,
          `2026-09-${String(index + 2).padStart(2, "0")}`,
        ),
      ),
    }),
  ]);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 14 (%)", { exact: true }).fill("");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await review(page)
    .getByRole("button", { name: "Show SKUs that need setup", exact: true })
    .click();
  await review(page).getByRole("button", { name: "Complete S1", exact: true }).click();
  const rate = editor(page).getByLabel("Fee rate 14 (%)", { exact: true });
  await expect(rate).toBeFocused();
  await expect(rate).toBeInViewport({ ratio: 1 });
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await rate.fill("6.25");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeEnabled();
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("blank fields stay quiet after a removal shifts periods; a cleared field survives reload", async ({
  page,
}) => {
  await setup(page, "administrator", [
    item("S1", {
      periods: [period("5", "2026-08-01", "2026-09-01"), period("6", "2026-09-01", null)],
      requirements: [],
    }),
  ]);
  await openEditor(page);
  const invalid = editor(page).locator('[aria-invalid="true"]');
  // The added period lands on the removed period's index; it is still blank and unvisited.
  await editor(page).getByRole("button", { name: "Remove period 2", exact: true }).click();
  await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await expect(editor(page).getByLabel("Marketplace 2", { exact: true })).toBeFocused();
  await expect(invalid).toHaveCount(0);
  // A cleared rate shows its error at once and keeps it after a reload.
  const rate = editor(page).getByLabel("Fee rate 1 (%)", { exact: true });
  await rate.fill("");
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await page.reload();
  await expect(rate).toHaveValue("");
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  // Marketplace 2 was left, so it was visited too; the period's other blank fields stay quiet.
  await expect(editor(page).getByLabel("Marketplace 2", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(invalid).toHaveCount(2);
});
