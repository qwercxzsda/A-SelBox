import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

const scenarios = [
  {
    column: "health_status",
    label: "Inventory health status",
    user: "member",
    urgent: "Out of stock",
    urgentAlias: "OUT_OF_STOCK",
    medium: "Low stock",
    least: "Healthy",
    unknown: "Unknown source health",
    unknownLabel: "Unknown source health",
    urgency: [40, 30, 0],
  },
  {
    column: "recommended_action",
    label: "Recommendation",
    user: "administrator",
    urgent: "GoToRestock",
    urgentAlias: "RESTOCK_INVENTORY",
    medium: "EditListing",
    least: "NoActionRequired",
    unknown: "UnknownSourceAction",
    unknownLabel: "Unknown source action",
    urgency: [50, 30, 0],
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
    await page.getByRole("checkbox", { name: scenario.unknownLabel, exact: true }).check();
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

const recommendations = [
  ["GoToRestock", "Restock", 50],
  ["CreateShippingPlan", "Create shipping plan", 50],
  ["SendToFBA", "Send to FBA", 50],
  ["GoToStranded", "Resolve stranded inventory", 40],
  ["Edit listing", "Edit listing", 30],
  ["Lower price", "Lower price", 20],
  ["Advertise listing", "Advertise listing", 10],
  ["NoRestockExcessActionRequired", "No restock or excess action required", 0],
  ["NoExcessInventory", "No excess inventory", 0],
  ["NoActionRequired", "No action required", 0],
  ["UnknownSourceAction", "Unknown source action", null],
  ["REVIEW_FBA_ACTION", "Review FBA action", null],
  [null, "—", null],
];

for (const width of [1440, 390]) {
  test(`recommendation labels stay consistent in rows, details, filters, and search at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const auth = await mockSupabase(page);
    auth.roles["member-a"] = "administrator";
    const inventory = await mockInventory(
      page,
      recommendations.map(([action, , urgency], index) =>
        inventoryRow(`LABEL-${String(index + 1).padStart(2, "0")}`, {
          recommended_action: action,
          recommended_action_urgency: urgency,
        }),
      ),
    );
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    const region = page.getByRole("region", { name: "Inventory items", exact: true });
    await expect(region.locator("tbody tr")).toHaveCount(recommendations.length);
    for (const [index, [raw, label]] of recommendations.entries()) {
      const value = region.locator("tbody tr").nth(index).locator(".inventory-action-label");
      await expect(value).toHaveText(label);
      if (raw !== null) expect(await value.getAttribute("title")).toContain(raw);
    }

    const stranded = region.locator("tbody tr").nth(3).locator(".inventory-action-label");
    await stranded.scrollIntoViewIfNeeded();
    await stranded.click();
    const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await expect(detail.locator(".inventory-action-label")).toHaveText(
      "Resolve stranded inventory",
    );
    expect(await detail.locator(".inventory-action-label").getAttribute("title")).toContain(
      "GoToStranded",
    );
    await detail.getByRole("button", { name: "Close inventory details", exact: true }).click();
    await expect(detail).toBeHidden();

    await region.getByRole("button", { name: "Recommendation", exact: true }).click();
    const options = page.getByRole("dialog", { name: "Recommendation options", exact: true });
    const expectedLabels = [
      "Create shipping plan",
      "Restock",
      "Send to FBA",
      "Resolve stranded inventory",
      "Edit listing",
      "Lower price",
      "Advertise listing",
      "No action required",
      "No excess inventory",
      "No restock or excess action required",
      "Review FBA action",
      "Unavailable",
      "Unknown source action",
    ];
    await expect(options.getByRole("checkbox")).toHaveCount(expectedLabels.length);
    expect(
      await options
        .getByRole("checkbox")
        .evaluateAll((inputs) =>
          inputs.map((input) => [...input.labels].map((label) => label.textContent).join(" ")),
        ),
    ).toEqual(expectedLabels);
    await options
      .getByRole("checkbox", { name: "Resolve stranded inventory", exact: true })
      .check();
    await page.keyboard.press("Escape");
    await expect(region.locator(".inventory-sku")).toHaveText(["LABEL-04"]);
    expect(inventory.requests.at(-1).get("and")).toContain(
      'recommended_action.in.("GoToStranded")',
    );

    await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search", exact: true });
    await search.fill("shipping plan");
    await expect(region.locator(".inventory-sku")).toHaveText(["LABEL-02"]);
    expect(inventory.requests.at(-1).get("and")).toContain(
      'recommended_action.in.("CreateShippingPlan")',
    );
    await search.fill("review fba action");
    await expect(region.locator(".inventory-sku")).toHaveText(["LABEL-12"]);
    await expect(region.locator(".inventory-action-label")).toHaveText("Review FBA action");
    expect(inventory.requests.at(-1).get("and")).toContain(
      'recommended_action.in.("REVIEW_FBA_ACTION")',
    );
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    ).toBe(true);
  });
}
