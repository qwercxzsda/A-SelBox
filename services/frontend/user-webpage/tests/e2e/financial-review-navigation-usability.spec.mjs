import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

async function openTypeRecords(page) {
  await openFinancialReview(page);
  await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await drawer
    .getByRole("button", {
      name: "View records for Data Kiosk · FBA storage fee",
      exact: true,
    })
    .click();
  const records = drawer.getByRole("region", { name: "Source records", exact: true });
  await expect(records).toBeFocused();
  return { drawer, records };
}

for (const width of [390, 1440]) {
  test(`clearing a review type keeps keyboard navigation in source records at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { drawer, records } = await openTypeRecords(page);
    const clear = records.getByRole("button", { name: "Clear selected type", exact: true });
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(clear).toHaveCount(0);
    const source = records.getByRole("combobox", { name: "Record source", exact: true });
    await expect(source).toBeFocused();
    await expect(source).toHaveValue("DATA_KIOSK");
    await expect(drawer.getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  });

  test(`review records offer a return to amounts without changing the selected scope at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { drawer, records } = await openTypeRecords(page);
    const amounts = drawer.getByRole("region", { name: "Amounts by type", exact: true });
    const back = records.getByRole("button", { name: "Back to amounts", exact: true });
    await expect(back).toBeInViewport();
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(amounts).toBeFocused();
    await expect(
      amounts.getByRole("heading", { name: "Amounts by type", exact: true }),
    ).toBeInViewport();
    await expect(records.getByRole("combobox", { name: "Record source", exact: true })).toHaveValue(
      "DATA_KIOSK",
    );
    await expect(
      records.getByRole("button", { name: "Clear selected type", exact: true }),
    ).toHaveCount(1);
  });
}
