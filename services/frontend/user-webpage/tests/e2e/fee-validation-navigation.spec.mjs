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
  await review(page).getByRole("button", { name: "Show setup issues (1)", exact: true }).click();
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
