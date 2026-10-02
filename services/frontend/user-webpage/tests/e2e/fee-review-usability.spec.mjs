import { expect, test } from "@playwright/test";
import {
  setup,
  item,
  period,
  editor,
  review,
  openEditor,
  openReview,
  OTHER_COMPANY,
} from "./sku-configuration-fixtures.mjs";

function contrastOnWhite(element) {
  const style = globalThis.getComputedStyle(element);
  const rgb = (color) => color.match(/[\d.]+/g).map(Number);
  const foreground = rgb(style.color);
  const background = rgb(style.backgroundColor);
  const alpha = background[3] ?? 1;
  const luminance = (channels) =>
    channels
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const front = luminance(foreground);
  const back = luminance(background.map((channel) => channel * alpha + 255 * (1 - alpha)));
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

async function expectReadableAction(action) {
  for (const hovered of [false, true]) {
    if (hovered) await action.hover();
    expect(await action.evaluate(contrastOnWhite)).toBeGreaterThanOrEqual(4.5);
  }
}

test("desktop fee review makes changed rates, removed periods, and company reassignment explicit", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const periods = Array.from({ length: 12 }, (_, index) =>
    period(
      "5",
      `2026-${String(index + 1).padStart(2, "0")}-01`,
      index === 11 ? null : `2026-${String(index + 2).padStart(2, "0")}-01`,
    ),
  );
  const fixture = await setup(page, "operator", [item("S1", { periods })]);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.123456");
  await editor(page).getByLabel("Company", { exact: true }).selectOption(OTHER_COMPANY);
  await expectReadableAction(
    editor(page).getByRole("button", { name: "Remove period 2", exact: true }),
  );
  await editor(page).getByRole("button", { name: "Remove period 2", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "Keep draft", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("desktop-fee-editing.png"),
    animations: "disabled",
  });
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expectReadableAction(
    review(page).getByRole("button", { name: "Discard draft for S1", exact: true }),
  );
  const changes = review(page).getByRole("region", { name: "Changes for S1", exact: true });
  await expect(changes).toContainText("Alpha Company → Beta Company");
  await expect(changes).toContainText("5% → 6.123456%");
  await expect(changes).toContainText("Period removed");
  await expect(changes).toContainText("2026-02-01 (inclusive) → 2026-03-01 (exclusive)");
  for (const badge of await changes.locator(".mantine-Badge-root").all())
    expect(await badge.evaluate(contrastOnWhite)).toBeGreaterThanOrEqual(4.5);
  const save = review(page).getByRole("button", { name: "Save all changes", exact: true });
  await expect(save).toBeEnabled();
  await expect(save).toBeInViewport();
  await review(page).getByLabel("Reason for changes (optional)").fill("Update agreed fee periods");
  await page.screenshot({
    path: testInfo.outputPath("desktop-fee-review.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(changes).toContainText("5% → 6.123456%");
  await expect(review(page).getByLabel("Reason for changes (optional)")).toHaveValue(
    "Update agreed fee periods",
  );
  expect(fixture.configurationSaves).toHaveLength(0);
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(1);
  expect(fixture.configurationSaves[0].p_changes[0].periods).toHaveLength(11);
  expect(fixture.configurationSaves[0].p_changes[0].periods[0].fee_rate_percent).toBe("6.123456");
});

test("a blocked review explains the disabled save and jumps directly to required setup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, "operator", [item("S1"), item("S2", { company_id: null })]);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  const issues = review(page).getByRole("button", { name: "Show setup issues (1)", exact: true });
  await expect(issues).toBeInViewport();
  await issues.click();
  const complete = review(page).getByRole("button", { name: "Complete S2", exact: true });
  await expect(complete).toBeInViewport();
  await complete.click();
  await expect(page.getByRole("dialog", { name: "Edit S2", exact: true })).toBeVisible();
});
