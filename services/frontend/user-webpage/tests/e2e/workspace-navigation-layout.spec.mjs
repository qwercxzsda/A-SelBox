import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

for (const { width, font } of [
  { width: 320 },
  { width: 390 },
  { width: 834 },
  { width: 390, font: "Georgia, serif" },
]) {
  test(`workspace tabs keep their positions at ${width}px${font ? " with a fallback font" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    await mockInventory(page, [inventoryRow("NAV-001")]);
    await signIn(page);
    if (font) await page.addStyleTag({ content: `.dataset-tabs { font-family: ${font}; }` });
    const tabs = page.getByRole("tablist", { name: "Workspace data", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(9);
    const positions = async () =>
      tabs.getByRole("tab").evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
          };
        }),
      );
    const initial = await positions();
    for (const name of [
      "Current fees",
      "Payout reports",
      "Inventory",
      "Financial review",
      "Transactions",
    ]) {
      await tabs.getByRole("tab", { name, exact: true }).click();
      await expect(tabs.getByRole("tab", { name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect.poll(positions).toEqual(initial);
    }
  });
}
