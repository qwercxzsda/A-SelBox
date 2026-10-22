import { expect, test } from "@playwright/test";
import {
  setup,
  item,
  editor,
  review,
  openEditor,
  openReview,
} from "./sku-configuration-fixtures.mjs";

test("review setup controls remain fully reachable in a short zoomed viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await setup(page, "administrator", [item("S1", { company_id: null })]);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await review(page).getByRole("button", { name: "Show setup issues (1)", exact: true }).click();
  const complete = review(page).getByRole("button", { name: "Complete S1", exact: true });
  await complete.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("short-review.png"), animations: "disabled" });
  await expect(complete).toBeInViewport({ ratio: 1 });
  await complete.click();
  const company = editor(page).getByRole("combobox", { name: "Company", exact: true });
  await company.scrollIntoViewIfNeeded();
  await expect(company).toBeInViewport({ ratio: 1 });
  const keep = editor(page).getByRole("button", { name: "Keep draft", exact: true });
  await keep.scrollIntoViewIfNeeded();
  await expect(keep).toBeInViewport({ ratio: 1 });
});
