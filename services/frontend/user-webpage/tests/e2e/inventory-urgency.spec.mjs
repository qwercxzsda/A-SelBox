import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

const scenarios = [
  {
    column: "health_status",
    label: "Inventory health status",
    user: "company_member",
    urgent: "Out of stock",
    urgentAlias: "OUT_OF_STOCK",
    medium: "Low stock",
    least: "Healthy",
    unknown: "Unknown source health",
    urgency: [40, 30, 0],
  },
  {
    column: "recommended_action",
    label: "Recommendation",
    user: "operator",
    urgent: "EditListing",
    urgentAlias: "Edit listing",
    medium: "GoToRestock",
    least: "SendToFBA",
    unknown: "UnknownSourceAction",
    urgency: [50, 40, 30],
  },
];

for (const scenario of scenarios) {
  test(`${scenario.user} orders ${scenario.label} by urgency across pages and reloads, with unknowns last`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const auth = await mockSupabase(page);
    auth.roles["member-a"] = scenario.user;
    const rankColumn = `${scenario.column}_urgency`;
    const row = (sku, value, urgency) =>
      inventoryRow(sku, { [scenario.column]: value, [rankColumn]: urgency });
    const inventory = await mockInventory(page, [
      ...Array.from({ length: 24 }, (_, index) =>
        row(`Z-urgent-${String(index + 1).padStart(2, "0")}`, scenario.urgent, scenario.urgency[0]),
      ),
      row("Y-urgent-alias", scenario.urgentAlias, scenario.urgency[0]),
      ...Array.from({ length: 26 }, (_, index) =>
        row(`M-medium-${String(index + 1).padStart(2, "0")}`, scenario.medium, scenario.urgency[1]),
      ),
      row("A-least", scenario.least, scenario.urgency[2]),
      row("B-unknown", scenario.unknown, null),
      row("C-unavailable", null, null),
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
    await heading.click();
    await expect(page.getByRole("button", { name: "A to Z", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Most urgent first", exact: true }).click();
    await expect(skus).toHaveText([
      "Y-urgent-alias",
      ...Array.from({ length: 24 }, (_, index) => `Z-urgent-${String(index + 1).padStart(2, "0")}`),
    ]);
    expect(inventory.requests.at(-1).get("order")).toBe(
      `${rankColumn}.desc.nullslast,sku.asc,marketplace_name.asc,capture_id.asc`,
    );
    await expect(heading.locator("..")).toHaveAttribute("aria-sort", "descending");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus.first()).toHaveText("M-medium-01");
    await expect(skus.last()).toHaveText("M-medium-25");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus).toHaveText(["M-medium-26", "A-least", "B-unknown", "C-unavailable"]);
    await page.reload();
    await expect(skus).toHaveText(["M-medium-26", "A-least", "B-unknown", "C-unavailable"]);
    expect(inventory.requests.at(-1).get("offset")).toBe("50");
    expect(inventory.requests.at(-1).get("order")).toBe(
      `${rankColumn}.desc.nullslast,sku.asc,marketplace_name.asc,capture_id.asc`,
    );
    await heading.click();
    await page.getByRole("button", { name: "Least urgent first", exact: true }).click();
    await expect(skus.first()).toHaveText("A-least");
    await expect(skus.last()).toHaveText("M-medium-24");
    expect(inventory.requests.at(-1).get("offset")).toBe("0");
    expect(inventory.requests.at(-1).get("order")).toBe(
      `${rankColumn}.asc.nullslast,sku.asc,marketplace_name.asc,capture_id.asc`,
    );
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus.first()).toHaveText("M-medium-25");
    await navigation.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skus).toHaveText(["Z-urgent-23", "Z-urgent-24", "B-unknown", "C-unavailable"]);
    await heading.click();
    await page.getByRole("checkbox", { name: scenario.unknown, exact: true }).check();
    await page.getByRole("checkbox", { name: "Unavailable", exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(skus).toHaveText(["B-unknown", "C-unavailable"]);
    expect(inventory.requests.at(-1).get("and")).toContain(
      `${scenario.column}.in.(${JSON.stringify(scenario.unknown)})`,
    );
    expect(inventory.requests.at(-1).get("and")).toContain(`${scenario.column}.is.null`);
    expect(inventory.requests.at(-1).get("offset")).toBe("0");
  });
}
