import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

for (const user of ["company_member", "operator"]) {
  test(`${user} sees reported inventory groups, exact values and source dates without shipment controls`, async ({
    page,
  }, testInfo) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = user;
    await mockInventory(page, [
      inventoryRow("ELG_Black", {
        sales_amount_90d: "9007199254740993.123456789",
        currency: "USD",
        units_shipped_90d: "1",
        available_quantity: "0",
        health_status: "Out of stock",
        recommended_ship_in_units: "1347",
        recommended_ship_in_date: "2026-09-30",
        recommended_action: user === "operator" ? "SendToFBA" : "GoToRestock",
        minimum_inventory_units: "1",
      }),
    ]);
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(page.getByText("Estimated totals", { exact: true })).toHaveCount(0);
    const region = page.getByRole("region", { name: "Inventory items" });
    await expect(region.getByText("ELG_Black", { exact: true })).toBeVisible();
    await expect(region.getByRole("columnheader")).toHaveText([
      "SKU↑",
      "Sales · last 90 days↕",
      "Inventory overview",
      "Inventory health status↕",
      "Recommendation↕",
    ]);
    await expect(
      region.getByText("9,007,199,254,740,993.123456789 USD", { exact: true }),
    ).toBeVisible();
    await expect(region.getByText("Available", { exact: true }).locator("..")).toHaveText(
      "Available0",
    );
    await expect(region.getByText("Reserved", { exact: true })).toHaveCount(0);
    await expect(region.getByText(/Snapshot:|Capture:|Report:|Processed:/)).toHaveCount(0);
    await expect(region.locator(".inventory-health-label")).toHaveText("Out of stock");
    await expect(region.locator(".inventory-action-label")).toHaveText(
      user === "operator" ? "Send to FBA" : "Restock",
    );
    await region.getByText("Amazon.com", { exact: true }).click();
    const details = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await expect(details.getByText("Reserved", { exact: true }).locator("..")).toHaveText(
      "Reserved—",
    );
    await details.getByText("Source capture", { exact: true }).click();
    await expect(details.getByText("2026-09-27", { exact: true })).toBeVisible();
    await expect(details.getByText("2026-09-28", { exact: true })).toBeVisible();
    await expect(details.getByText("2026-09-28 03:00:00 UTC", { exact: true })).toBeVisible();
    await expect(details.getByText("2026-09-28 04:00:00 UTC", { exact: true })).toBeVisible();
    await expect(details.getByText("Inbound received", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send to FBA|Create shipment/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Refresh inventory|Retry inventory/ }),
    ).toHaveCount(0);
    await captureResponsiveReview(page, testInfo, `inventory-${user}`);
  });
}

test("inventory server paging, exact punctuation filters and tab state stay independent of transactions", async ({
  page,
}) => {
  await mockSupabase(page);
  const special = ' SKU.*_%(),"\\ ';
  const fixture = await mockInventory(page, [
    ...Array.from({ length: 26 }, (_, index) =>
      inventoryRow(`SKU-${String(index).padStart(3, "0")}`),
    ),
    inventoryRow(special, { marketplace_name: "Amazon.ca" }),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByText("27 inventory items", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "Inventory pagination, top", exact: true })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(page.getByText("SKU-024", { exact: true })).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill(special);
  await expect(page.getByText("1 inventory item", { exact: true }).first()).toBeVisible();
  expect(fixture.requests.at(-1).get("offset")).toBe("0");
  expect(fixture.requests.at(-1).get("and")).toContain(`sku.in.(${JSON.stringify(special)})`);
  await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.com");
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue(special);
  await expect(page.getByLabel("Marketplace", { exact: true })).toHaveValue("Amazon.com");
  await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
  await expect(page.getByText("27 inventory items", { exact: true }).first()).toBeVisible();
});

test("inventory recovers automatically from an initial failure with unchanged revisions and no reload buttons", async ({
  page,
}) => {
  await page.clock.install();
  await mockSupabase(page);
  const fixture = await mockInventory(page, [inventoryRow("FIRST")]);
  fixture.failed = true;
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByText(/Could not load inventory/)).toBeVisible();
  await expect(page.getByText("private database details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Refresh inventory|Retry inventory/ })).toHaveCount(
    0,
  );
  fixture.failed = false;
  await page.clock.fastForward(60_000);
  await expect(page.getByText("FIRST", { exact: true })).toBeVisible();
  const requests = fixture.requests.length;
  await page.clock.fastForward(60_000);
  await expect(page.getByText("FIRST", { exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(requests);
});

test("desktop inventory menus search the whole catalog, filter before paging, and preserve controls on reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockSupabase(page);
  const inventory = await mockInventory(page, [
    ...Array.from({ length: 27 }, (_, index) =>
      inventoryRow(`SKU-${String(index).padStart(3, "0")}`, {
        sales_amount_90d: String(index),
        currency: "USD",
        health_status: "Healthy",
        recommended_action: "EditListing",
      }),
    ),
    inventoryRow("RESTOCK", {
      sales_amount_90d: "100",
      currency: "USD",
      health_status: "Low stock",
      recommended_action: "GoToRestock",
    }),
    inventoryRow("SEND", {
      sales_amount_90d: "100",
      currency: "USD",
      health_status: "Out of stock",
      recommended_action: "SendToFBA",
    }),
    inventoryRow("UNKNOWN"),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByText("30 inventory items", { exact: true }).first()).toBeVisible();
  const region = page.getByRole("region", { name: "Inventory items" });
  const skus = region.locator(".inventory-sku");
  const sales = region.getByRole("button", { name: "Sales · last 90 days", exact: true });
  await sales.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Highest first", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(skus.first()).toHaveText("RESTOCK");
  await expect(skus.nth(1)).toHaveText("SEND");
  expect(inventory.requests.at(-1).get("order")).toBe(
    "sales_amount_90d.desc.nullslast,sku.asc,marketplace_name.asc,capture_id.asc",
  );
  await expect(sales).toBeFocused();
  await page
    .getByRole("navigation", { name: "Inventory pagination, top", exact: true })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(skus.last()).toHaveText("UNKNOWN");
  await region.getByRole("button", { name: "SKU", exact: true }).click();
  await page.getByLabel("Search sku", { exact: true }).fill("RESTOCK");
  await page.getByRole("checkbox", { name: "RESTOCK", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(skus).toHaveText(["RESTOCK"]);
  expect(inventory.requests.at(-1).get("offset")).toBe("0");
  await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
  await region.getByRole("button", { name: "Inventory health status", exact: true }).click();
  await page.getByRole("checkbox", { name: "Unavailable", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(skus).toHaveText(["UNKNOWN"]);
  await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
  await region.getByRole("button", { name: "Recommendation", exact: true }).click();
  await page.getByRole("checkbox", { name: "Send to FBA", exact: true }).check();
  await page.getByRole("button", { name: "Least urgent first", exact: true }).click();
  await expect(skus).toHaveText(["SEND"]);
  await expect(region.locator(".inventory-action-label")).toHaveAttribute("data-tone", "shipment");
  const readsBeforeDetails = inventory.requests.length;
  await region.getByText("Amazon.com", { exact: true }).click();
  const details = page.getByRole("dialog", { name: "Inventory details", exact: true });
  await expect(details.getByText("Inbound received", { exact: true })).toBeVisible();
  expect(inventory.requests).toHaveLength(readsBeforeDetails);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(skus).toHaveText(["SEND"]);
  await expect(details.getByText("Inbound received", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Close inventory details", exact: true }).click();
  await expect(region.getByRole("columnheader").last()).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("button", { name: "Clear inventory filters", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("send to fba");
  await expect(skus).toHaveText(["SEND"]);
  await page.getByLabel("Search", { exact: true }).fill("not-present");
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  await expect(region.getByRole("button", { name: "Recommendation", exact: true })).toBeVisible();
});

test("recommendation badges keep readable text and high contrast across desktop and tablet", async ({
  page,
}) => {
  await mockSupabase(page);
  await mockInventory(page, [
    inventoryRow("EDIT", { recommended_action: "Edit listing" }),
    inventoryRow("RESTOCK", { recommended_action: "GoToRestock" }),
    inventoryRow("SEND", { recommended_action: "SendToFBA" }),
    inventoryRow("UNKNOWN", { recommended_action: "CustomRecommendation" }),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  const badges = page.locator(".inventory-action-label");
  await expect(badges).toHaveText([
    "Edit listing",
    "Restock",
    "Send to FBA",
    "CustomRecommendation",
  ]);
  const colors = await badges.evaluateAll((elements) =>
    elements.map((element) => {
      const style = globalThis.getComputedStyle(element);
      const luminance = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
          )
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(style.color),
        b = luminance(style.backgroundColor);
      return {
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        background: style.backgroundColor,
      };
    }),
  );
  for (const { contrast } of colors) expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(new Set(colors.slice(0, 3).map(({ background }) => background)).size).toBe(3);
  for (const width of [1920, 1440, 834, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
  }
});

test("inventory debounces typing while preserving raw search immediately across F5", async ({
  page,
}) => {
  await mockSupabase(page);
  const inventory = await mockInventory(page, [
    inventoryRow("SEND", { recommended_action: "SendToFBA" }),
    inventoryRow("RESTOCK", { recommended_action: "GoToRestock" }),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.locator(".inventory-sku")).toHaveCount(2);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const initialReads = inventory.requests.length;
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("S");
  await page.clock.runFor(100);
  await search.fill("SE");
  await page.clock.runFor(100);
  await search.fill("SEND");
  await page.clock.runFor(249);
  expect(inventory.requests).toHaveLength(initialReads);
  await page.clock.runFor(1);
  await expect.poll(() => inventory.requests.length).toBe(initialReads + 1);
  await page.clock.runFor(20);
  await expect(page.locator(".inventory-sku")).toHaveText(["SEND"]);
  expect(inventory.requests).toHaveLength(initialReads + 1);
  await search.fill(" restock ");
  await page.reload();
  await page.clock.resume();
  await expect(search).toHaveValue(" restock ");
  await expect(page.locator(".inventory-sku")).toHaveText(["RESTOCK"]);
  await page.getByRole("button", { name: "Sales · last 90 days", exact: true }).click();
  await page.getByRole("button", { name: "Highest first", exact: true }).click();
  await expect
    .poll(() => inventory.requests.at(-1).get("order"))
    .toContain("sales_amount_90d.desc");
});

test("an inventory revision refreshes catalog search while unchanged checks read no options", async ({
  page,
}) => {
  await page.clock.install();
  const workspace = await mockSupabase(page);
  const inventory = await mockInventory(page, [inventoryRow("EXISTING")]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("NEW");
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  const options = inventory.optionRequests.length;
  await poll(page, workspace);
  expect(inventory.optionRequests).toHaveLength(options);
  inventory.rows.push(inventoryRow("NEW-SKU"));
  workspace.revisions.inventory = "new-capture";
  await poll(page, workspace);
  await expect(page.locator(".inventory-sku")).toHaveText(["NEW-SKU"]);
  expect(inventory.optionRequests).toHaveLength(options + 1);
});

const financialReads = (fixture) => ({
  rows: fixture.requests.length,
  counts: fixture.countRequests.length,
  options: fixture.optionRequests.length,
  latest: fixture.latestRequests.length,
  totals: fixture.aggregateRequests.length,
  details: fixture.breakdownRequests.length,
  configuration: fixture.configurationRequests.length,
});

test("inventory retains data and retries failed revision checks without a manual retry button", async ({
  page,
}) => {
  await page.clock.install();
  const workspace = await mockSupabase(page);
  const inventory = await mockInventory(page, [inventoryRow("FIRST")]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByText("FIRST", { exact: true })).toBeVisible();
  const reads = inventory.requests.length;
  workspace.revisionStatus = 503;
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("alert")).toContainText("Updates retry automatically.");
  await expect(
    page.getByRole("button", { name: /Retry update|Refresh inventory|Retry inventory/ }),
  ).toHaveCount(0);
  await expect(page.getByText("FIRST", { exact: true })).toBeVisible();
  expect(inventory.requests).toHaveLength(reads);
  workspace.revisionStatus = 200;
  workspace.revisions.inventory = "1";
  inventory.rows = [inventoryRow("RECOVERED")];
  await poll(page, workspace);
  await expect(page.getByText("RECOVERED", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(inventory.requests).toHaveLength(reads + 1);
});

async function poll(page, fixture) {
  const completed = () => fixture.revisionRequests.filter((request) => request.completed).length;
  const before = completed();
  await page.clock.fastForward(60_000);
  await expect.poll(completed).toBeGreaterThan(before);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}

for (const role of ["company_member", "operator"]) {
  test(`${role} inventory uses lightweight checks and reloads only for inventory or ownership changes`, async ({
    page,
  }) => {
    await page.clock.install();
    const workspace = await mockSupabase(page);
    workspace.roles["member-a"] = role;
    const inventory = await mockInventory(page, [inventoryRow("FIRST")]);
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(page.getByText("FIRST", { exact: true })).toBeVisible();
    const reads = inventory.requests.length;
    const financial = financialReads(workspace);
    const catalogs = workspace.identityRequests.length;

    await poll(page, workspace);
    expect(workspace.revisionRequests.at(-1).sources).toContain("inventory");
    expect(inventory.requests).toHaveLength(reads);
    expect(financialReads(workspace)).toEqual(financial);
    expect(workspace.identityRequests).toHaveLength(catalogs);

    inventory.rows = [
      inventoryRow("SECOND", { capture_id: "capture-two", available_quantity: "5" }),
    ];
    workspace.revisions.inventory = "1";
    await poll(page, workspace);
    await expect(page.getByText("SECOND", { exact: true })).toBeVisible();
    await expect(page.getByText("FIRST", { exact: true })).toHaveCount(0);
    expect(inventory.requests).toHaveLength(reads + 1);
    expect(financialReads(workspace)).toEqual(financial);
    expect(workspace.identityRequests).toHaveLength(catalogs);

    await poll(page, workspace);
    expect(inventory.requests).toHaveLength(reads + 1);
    expect(financialReads(workspace)).toEqual(financial);

    // Source imports can update finance without rereading the unchanged inventory page.
    workspace.revisions.data_kiosk = "1";
    await poll(page, workspace);
    expect(inventory.requests).toHaveLength(reads + 1);
    // Administrators update their shared SKU catalog; hidden financial data stays inactive.
    expect(financialReads(workspace)).toEqual({
      ...financial,
      options: workspace.optionRequests.length,
    });
    if (role === "company_member")
      expect(workspace.revisionRequests.at(-1).sources).toEqual(["fees", "inventory"]);

    const previousCatalogs = workspace.identityRequests.length;
    inventory.rows = [inventoryRow("NEW-OWNERSHIP")];
    workspace.revisions.fees = "1";
    await poll(page, workspace);
    await expect(page.getByText("NEW-OWNERSHIP", { exact: true })).toBeVisible();
    expect(inventory.requests).toHaveLength(reads + 2);
    expect(workspace.identityRequests.length).toBeGreaterThan(previousCatalogs);
  });
}

test("inventory stays within narrow screens and its columns are keyboard reachable", async ({
  page,
}) => {
  const workspace = await mockSupabase(page);
  workspace.authSessionForRequest = ({ user }) => ({
    access_token: `token-${user}`,
    refresh_token: `refresh-${user}`,
    token_type: "bearer",
    expires_in: 3600,
    user: { id: user, email: `inventory-${"a".repeat(45)}@example.invalid` },
  });
  await mockInventory(page, [
    inventoryRow("LONG-SKU-WITH-SPACES AND PUNCTUATION_123", {
      health_status: "Unknown source health",
      recommended_action: "UnknownSourceAction",
    }),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  const region = page.getByRole("region", { name: "Inventory items" });
  await expect(region.locator(".inventory-health-label")).toHaveText("Unknown source health");
  await expect(region.locator(".inventory-action-label")).toHaveText("UnknownSourceAction");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await expect(page.getByText(/Scroll horizontally to see all columns/)).toBeVisible();
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
    const signOut = page.getByRole("button", { name: "Sign out", exact: true });
    await expect(signOut).toBeInViewport();
    expect(
      await signOut
        .locator(".mantine-Button-label")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await region.scrollIntoViewIfNeeded();
    await region.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const recommendation = region.locator(".inventory-action-label");
    await expect(recommendation).toBeInViewport();
    await expect(page.getByLabel("Search", { exact: true })).toBeVisible();
  }
});
