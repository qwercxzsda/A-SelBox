import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

const details = (page) => page.getByRole("dialog", { name: "Inventory details", exact: true });
const inventory = (page) => page.getByRole("region", { name: "Inventory items", exact: true });
const row = (page, sku) =>
  inventory(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: `Show transactions for ${sku}`, exact: true }),
    });
const metric = (page, label) => details(page).getByText(label, { exact: true }).locator("..");

async function openInventory(page, role, rows) {
  const workspace = await mockSupabase(page);
  workspace.roles["member-a"] = role;
  const fixture = await mockInventory(page, rows);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(inventory(page).locator("tbody tr").first()).toBeVisible();
  return { workspace, fixture };
}

async function checkRevision(page, workspace) {
  const completed = () => workspace.revisionRequests.filter((request) => request.completed).length;
  const before = completed();
  await page.clock.fastForward(60_000);
  await expect.poll(completed).toBeGreaterThan(before);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}

for (const role of ["company_member", "operator"]) {
  test(`${role} opens compact inventory rows by mouse and keyboard with complete exact details`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { fixture } = await openInventory(page, role, [
      inventoryRow("DETAIL-SKU", {
        available_quantity: "0",
        inbound_quantity: "19",
        fba_supply_quantity: "37",
        reserved_quantity: "6",
        unfulfillable_quantity: "2",
        inbound_working_quantity: "3",
        inbound_shipped_quantity: "5",
        inbound_received_quantity: "11",
        reserved_transfer_quantity: "1",
        reserved_processing_quantity: "2",
        reserved_customer_order_quantity: "3",
        sales_amount_90d: "9007199254740993.123456789",
        currency: "USD",
        units_shipped_90d: "101",
        health_status: "Low stock",
        minimum_inventory_units: "200",
        days_of_supply: "4.125",
        total_days_of_supply: "18.875",
        recommended_action: "GoToRestock",
        recommended_ship_in_units: "1347",
        recommended_ship_in_date: "2026-10-05",
      }),
    ]);
    const selected = row(page, "DETAIL-SKU");
    await expect(selected).toContainText("9,007,199,254,740,993.123456789 USD");
    await expect(selected.getByText("Available", { exact: true }).locator("..")).toHaveText(
      "Available0",
    );
    await expect(selected.getByText("Inbound", { exact: true }).locator("..")).toHaveText(
      "Inbound19",
    );
    for (const label of [
      "Supply at FBA",
      "Reserved",
      "Unfulfillable",
      "Inbound received",
      "Minimum inventory (units)",
      "Total days of supply",
      "Recommended ship-in date",
      "Inventory breakdown",
    ])
      await expect(selected.getByText(label, { exact: true })).toHaveCount(0);
    expect((await selected.boundingBox()).height).toBeLessThanOrEqual(132);
    const reads = fixture.requests.length;
    await selected.getByText("Amazon.com", { exact: true }).click();
    await expect(details(page)).toBeVisible();
    expect(fixture.requests).toHaveLength(reads);
    for (const [label, value] of [
      ["Sales", "9,007,199,254,740,993.123456789 USD"],
      ["Units shipped", "101"],
      ["Available", "0"],
      ["Inbound", "19"],
      ["Supply at FBA", "37"],
      ["Reserved", "6"],
      ["Unfulfillable", "2"],
      ["Inbound working", "3"],
      ["Inbound shipped", "5"],
      ["Inbound received", "11"],
      ["Reserved transfer", "1"],
      ["Reserved processing", "2"],
      ["Reserved customer orders", "3"],
      ["Minimum inventory (units)", "200"],
      ["Days of supply", "4.125"],
      ["Total days of supply", "18.875"],
      ["Recommended ship-in units", "1,347"],
      ["Recommended ship-in date", "2026-10-05"],
    ])
      await expect(metric(page, label)).toHaveText(label + value);
    await expect(details(page).locator(".inventory-health-label")).toHaveText("Low stock");
    await expect(details(page).locator(".inventory-action-label")).toHaveText("Restock");
    await page.screenshot({
      path: testInfo.outputPath(`inventory-details-${role}-desktop.png`),
      animations: "disabled",
    });
    await details(page)
      .getByRole("button", { name: "Close inventory details", exact: true })
      .click();
    await expect(details(page)).toHaveCount(0);
    for (const key of ["Enter", "Space"]) {
      await selected.focus();
      await page.keyboard.press(key);
      await expect(details(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(details(page)).toHaveCount(0);
      await expect(selected).toBeFocused();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await selected.getByText("Amazon.com", { exact: true }).click();
    await expect(
      details(page).getByRole("button", { name: "Close inventory details" }),
    ).toBeInViewport();
    expect(
      await details(page).evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath(`inventory-details-${role}-phone.png`),
      animations: "disabled",
    });
  });
}

test("inventory details distinguish missing metrics from zero and SKU navigation closes the drawer", async ({
  page,
}) => {
  await openInventory(page, "operator", [
    inventoryRow("ZERO", { available_quantity: "0", minimum_inventory_units: "0" }),
  ]);
  await row(page, "ZERO").getByText("Amazon.com", { exact: true }).click();
  await expect(metric(page, "Available")).toHaveText("Available0");
  await expect(metric(page, "Minimum inventory (units)")).toHaveText("Minimum inventory (units)0");
  await expect(metric(page, "Reserved")).toHaveText("Reserved—");
  await expect(metric(page, "Sales")).toHaveText("Sales—");
  await expect(metric(page, "Recommended ship-in date")).toHaveText("Recommended ship-in date—");
  await details(page)
    .getByRole("button", { name: "Show transactions for ZERO", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(details(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(details(page)).toHaveCount(0);
  await row(page, "ZERO")
    .getByRole("button", { name: "Show transactions for ZERO", exact: true })
    .click();
  await expect(details(page)).toHaveCount(0);
});

test("inventory F5 restores the selected capture using fresh data and revisions never keep stale details", async ({
  page,
}) => {
  await page.clock.install();
  const { workspace, fixture } = await openInventory(page, "operator", [
    inventoryRow("CURRENT", { available_quantity: "10" }),
  ]);
  await row(page, "CURRENT").getByText("Amazon.com", { exact: true }).click();
  await expect(metric(page, "Available")).toHaveText("Available10");
  fixture.rows[0].available_quantity = "12";
  const reads = fixture.requests.length;
  await page.reload();
  await expect(details(page)).toBeVisible();
  await expect(metric(page, "Available")).toHaveText("Available12");
  expect(fixture.requests.length).toBeGreaterThan(reads);
  fixture.rows[0].available_quantity = "14";
  workspace.revisions.inventory = "edited-capture";
  await checkRevision(page, workspace);
  await expect(metric(page, "Available")).toHaveText("Available14");
  fixture.rows = [
    inventoryRow("CURRENT", { capture_id: "next-capture", available_quantity: "90" }),
  ];
  workspace.revisions.inventory = "new-capture";
  await checkRevision(page, workspace);
  await expect(details(page)).toHaveCount(0);
  await expect(
    row(page, "CURRENT").getByText("Available", { exact: true }).locator(".."),
  ).toHaveText("Available90");
  await row(page, "CURRENT").getByText("Amazon.com", { exact: true }).click();
  fixture.rows = [];
  workspace.revisions.inventory = "item-removed";
  await checkRevision(page, workspace);
  await expect(details(page)).toHaveCount(0);
  await expect(
    page.getByText("No inventory items are available for your account.", { exact: true }),
  ).toBeVisible();
});

test("inventory details keep identical SKUs from different source captures distinct", async ({
  page,
}) => {
  const { fixture } = await openInventory(page, "operator", [
    inventoryRow("SHARED", { capture_id: "first-source", available_quantity: "11" }),
    inventoryRow("SHARED", { capture_id: "second-source", available_quantity: "22" }),
  ]);
  await row(page, "SHARED").nth(1).getByText("Amazon.com", { exact: true }).click();
  await expect(metric(page, "Available")).toHaveText("Available22");
  await page.reload();
  await expect(metric(page, "Available")).toHaveText("Available22");
  fixture.rows.pop();
  await page.reload();
  await expect(row(page, "SHARED")).toBeVisible();
  await expect(details(page)).toHaveCount(0);
});

test("inventory restores details only for a row on the current page and retains controls after closing", async ({
  page,
}) => {
  const { fixture } = await openInventory(
    page,
    "company_member",
    Array.from({ length: 26 }, (_, index) => inventoryRow(`SKU-${String(index).padStart(2, "0")}`)),
  );
  await row(page, "SKU-24").getByText("Amazon.com", { exact: true }).click();
  await expect(details(page)).toBeVisible();
  fixture.rows.push(inventoryRow("FIRST"));
  const reads = fixture.requests.length;
  await page.reload();
  await expect(details(page)).toHaveCount(0);
  await expect(row(page, "SKU-00")).toBeVisible();
  expect(fixture.requests.length).toBeGreaterThan(reads);
  expect(fixture.requests.slice(reads).every((request) => request.get("offset") === "0")).toBe(
    true,
  );
  for (const action of [
    async () =>
      page
        .getByRole("navigation", { name: "Inventory pagination, top", exact: true })
        .getByRole("button", { name: "Next", exact: true })
        .click(),
    async () => page.getByLabel("Search", { exact: true }).fill("SKU-25"),
    async () => {
      await inventory(page).getByRole("button", { name: "SKU", exact: true }).click();
      await page.getByRole("button", { name: "Z to A", exact: true }).click();
    },
  ]) {
    await inventory(page)
      .locator("tbody tr")
      .first()
      .getByText("Amazon.com", { exact: true })
      .click();
    await expect(details(page)).toBeVisible();
    await details(page)
      .getByRole("button", { name: "Close inventory details", exact: true })
      .click();
    await action();
    await expect(details(page)).toHaveCount(0);
    await page.reload();
    await expect(details(page)).toHaveCount(0);
  }
});
