import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

for (const scenario of [
  {
    column: "health_status",
    label: "Inventory health status",
    user: "member",
    urgent: "Out of stock",
    medium: "Low stock",
    least: "Healthy",
  },
  {
    column: "recommended_action",
    label: "Recommendation",
    user: "administrator",
    urgent: "GoToRestock",
    medium: "Edit listing",
    least: "NoExcessInventory",
  },
]) {
  test(`${scenario.user} orders ${scenario.label} across the complete inventory before paging`, async ({
    page,
  }) => {
    const auth = await mockSupabase(page);
    auth.roles["member-a"] = scenario.user;
    const inventory = await mockInventory(page, [
      ...Array.from({ length: 26 }, (_, i) =>
        inventoryRow(`Z-urgent-${String(i).padStart(2, "0")}`, {
          [scenario.column]: scenario.urgent,
        }),
      ),
      ...Array.from({ length: 26 }, (_, i) =>
        inventoryRow(`M-medium-${String(i).padStart(2, "0")}`, {
          [scenario.column]: scenario.medium,
        }),
      ),
      inventoryRow("A-least", { [scenario.column]: scenario.least }),
      inventoryRow("B-unavailable"),
    ]);
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    const region = page.getByRole("region", { name: "Inventory items" });
    const skus = region.locator(".inventory-sku");
    const heading = region.getByRole("button", { name: scenario.label, exact: true });
    const navigation = page.getByRole("navigation", {
      name: "Inventory pagination, top",
      exact: true,
    });
    await expect(skus.first()).toHaveText("A-least");
    const reads = inventory.requests.length;
    await heading.click();
    await page.getByRole("button", { name: "Most urgent first", exact: true }).click();
    await expect(skus.first()).toHaveText("Z-urgent-00");
    await expect(skus.last()).toHaveText("Z-urgent-24");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus.first()).toHaveText("Z-urgent-25");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus).toHaveText(["M-medium-24", "M-medium-25", "A-least", "B-unavailable"]);
    expect(inventory.requests).toHaveLength(reads);
    await page.reload();
    await expect(skus).toHaveText(["M-medium-24", "M-medium-25", "A-least", "B-unavailable"]);
    await heading.click();
    await page.getByRole("button", { name: "Least urgent first", exact: true }).click();
    await expect(skus.first()).toHaveText("A-least");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus).toHaveText(["Z-urgent-23", "Z-urgent-24", "Z-urgent-25", "B-unavailable"]);
    await heading.click();
    await page.getByRole("checkbox", { name: "Unavailable", exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(skus).toHaveText(["B-unavailable"]);
    expect(
      inventory.requests.every(
        (request) => request.get("order") === "capture_id.asc,sku.asc" && !request.has("and"),
      ),
    ).toBe(true);
  });
}

for (const width of [1440, 390]) {
  test(`fixed recommendation choices, colors, labels and literal search agree at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockSupabase(page);
    const inventory = await mockInventory(page, [
      inventoryRow("STRANDED", { recommended_action: "GoToStranded" }),
      inventoryRow("PLAN", { recommended_action: "CreateShippingPlan" }),
    ]);
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    const region = page.getByRole("region", { name: "Inventory items" });
    await expect(region.locator(".inventory-action-label")).toHaveText([
      "Create shipping plan",
      "Resolve stranded inventory",
    ]);
    const stranded = region.locator(".inventory-action-label").nth(1);
    await expect(stranded).toHaveAttribute("title", "GoToStranded");
    await expect(stranded).toHaveAttribute("data-tone", "attention");
    await stranded.click();
    const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await expect(detail.locator(".inventory-action-label")).toHaveText(
      "Resolve stranded inventory",
    );
    await detail.getByRole("button", { name: "Close inventory details", exact: true }).click();
    await region.getByRole("button", { name: "Recommendation", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Recommendation options", exact: true });
    await expect(menu.getByRole("checkbox")).toHaveCount(10);
    await expect(menu.getByRole("checkbox", { name: "Send to FBA", exact: true })).toBeVisible();
    await menu.getByRole("checkbox", { name: "Resolve stranded inventory", exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(region.locator(".inventory-sku")).toHaveText(["STRANDED"]);
    await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill("shipping plan");
    await expect(region.locator(".inventory-sku")).toHaveText(["PLAN"]);
    expect(inventory.requests).toHaveLength(2);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    ).toBe(true);
  });
}
