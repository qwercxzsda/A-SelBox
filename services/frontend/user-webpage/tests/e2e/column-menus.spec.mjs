import { liveRow, skuAssignment } from "./api-fixtures.mjs";
import { openColumn } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

async function selectOption(page, label, option) {
  const menu = await openColumn(page, label);
  if (label === "Type") await menu.getByLabel("Search type", { exact: true }).fill(option);
  await menu.getByRole("checkbox", { name: option, exact: true }).check();
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

function filteredRows() {
  const target = (index, overrides = {}) => ({
    ...liveRow("TARGET", index),
    sku: "TARGET",
    source: "DATA_KIOSK",
    component_type: "FBA_STORAGE_FEE",
    activity_date: "2026-09-02",
    source_amount: String(-10 * index),
    ...overrides,
  });
  return [
    ...Array.from({ length: 26 }, (_, index) => ({
      ...liveRow("OTHER", index + 1),
      marketplace_name: index === 0 ? "Amazon.co.jp" : "Amazon.com",
    })),
    target(1),
    target(2, { activity_date: "2026-09-03" }),
    target(3, { activity_date: "2026-09-01" }),
    target(4, { activity_date: "2026-09-04" }),
    target(5, { marketplace_name: "Amazon.co.uk" }),
    target(6, { source: "SETTLEMENT" }),
    target(7, { component_type: "PRINCIPAL" }),
    target(8, { sku: "DIFFERENT" }),
    target(9, { source_amount: "0" }),
  ];
}

test("column filters combine with search and inclusive dates, reset the page, and survive tab changes", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = filteredRows();
  fixture.assignments = [{ ...skuAssignment(1), sku: "TARGET" }];
  await signIn(page);
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("Amazon");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("Amazon");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  const originalOrder = fixture.requests.at(-1).params.get("order");
  await selectOption(page, "SKU", "TARGET");
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await selectOption(page, "Marketplace", "Amazon.com");
  await selectOption(page, "Source", "Data Kiosk");
  await selectOption(page, "Type", "FBA storage fee");
  const dates = await openColumn(page, "Date");
  await dates.getByLabel("From date", { exact: true }).fill("2026-09-03");
  await dates.getByLabel("To date", { exact: true }).fill("2026-09-02");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(dates.getByRole("alert")).toHaveText("From date must be on or before To date.");
  await dates.getByLabel("From date", { exact: true }).fill("2026-09-02");
  await dates.getByLabel("To date", { exact: true }).fill("2026-09-03");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("cell", { name: "2026-09-02", exact: true })).toHaveCount(2);
  await expect(table.getByRole("cell", { name: "2026-09-03", exact: true })).toHaveCount(1);
  const params = fixture.requests.at(-1).params;
  expect(params.getAll("activity_date")).toEqual(["gte.2026-09-02", "lte.2026-09-03"]);
  expect(params.get("sku")).toBe('in.("TARGET")');
  expect(params.get("marketplace_name")).toBe('in.("Amazon.com")');
  expect(params.get("source")).toBe('in.("DATA_KIOSK")');
  expect(params.get("component_type")).toBe('in.("FBA_STORAGE_FEE")');
  expect(params.get("and")).toBeNull();
  expect(params.get("or")).toContain("Amazon");
  expect(params.get("order")).toBe(originalOrder);
  expect(params.get("offset")).toBe("0");

  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(4);
  const sourceMenu = await openColumn(page, "Source");
  await expect(sourceMenu.getByRole("checkbox", { name: "Data Kiosk", exact: true })).toBeChecked();
  await expect(sourceMenu.getByRole("checkbox")).toHaveCount(2);
  await expect(sourceMenu.getByLabel("Search source", { exact: true })).toHaveCount(0);
  await sourceMenu.getByRole("button", { name: "Close options", exact: true }).click();
  const restoredDates = await openColumn(page, "Date");
  await expect(restoredDates.getByLabel("From date", { exact: true })).toHaveValue("2026-09-02");
  await expect(restoredDates.getByLabel("To date", { exact: true })).toHaveValue("2026-09-03");
  await restoredDates.getByLabel("From date", { exact: true }).fill("2026-09-10");
  await restoredDates.getByLabel("To date", { exact: true }).fill("2026-09-11");
  await restoredDates.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(26);
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Amazon");
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
});

test("administrator SKU options include unassigned imports from one complete catalog despite repeated transaction values", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  const lastSku = "ZZZ, last (special)";
  fixture.liveRows = [
    ...Array.from({ length: 1001 }, (_, index) => ({ ...liveRow("FIRST", index + 1), sku: "AAA" })),
    ...Array.from({ length: 8 }, (_, index) => ({
      ...liveRow("MIDDLE", index + 1),
      sku: `MIDDLE-${index}`,
    })),
    { ...liveRow("LAST", 1), sku: lastSku, activity_date: "2026-08-31" },
    { ...liveRow("ZERO", 1), sku: "ZZZ-ZERO-ONLY", source: "DATA_KIOSK", source_amount: "0" },
  ];
  await signIn(page);
  await expect(page.getByRole("form", { name: "Page 1 of 41", exact: true })).toBeVisible();
  expect(fixture.optionRequests).toHaveLength(1);
  await expect(page.getByRole("cell", { name: lastSku, exact: true })).toHaveCount(0);
  const originalOrder = fixture.requests.at(-1).params.get("order");
  const menu = await openColumn(page, "SKU");
  await menu.getByLabel("Search sku", { exact: true }).fill("ZZZ");
  const lastOption = menu.getByRole("checkbox", { name: lastSku, exact: true });
  await expect(lastOption).toBeVisible();
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await expect(menu.getByLabel("Search sku", { exact: true })).toBeVisible();
  await expect(menu.getByRole("checkbox", { name: "ZZZ-ZERO-ONLY", exact: true })).toHaveCount(1);
  expect(fixture.optionRequests).toHaveLength(1);
  expect(fixture.optionRequests[0].args).toEqual({});
  expect(fixture.optionRequests.every((request) => !request.includeCount)).toBe(true);
  expect(
    fixture.optionRequests.every(
      (request) =>
        request.endpoint === "/rest/v1/rpc/sku_filter_options" &&
        Object.keys(request.args).length === 0,
    ),
  ).toBe(true);
  await lastOption.check();
  await expect(menu).toBeVisible();
  await expect(rowWithSku(page, lastSku)).toBeVisible();
  expect(fixture.requests.at(-1).params.get("sku")).toBe(`in.("${lastSku}")`);
  expect(fixture.requests.at(-1).params.get("order")).toBe(originalOrder);
  await menu.getByLabel("Search sku", { exact: true }).fill("");
  await menu.getByRole("checkbox", { name: "AAA", exact: true }).check();
  await expect(page.getByRole("form", { name: "Page 1 of 41", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "Clear sku", exact: true }).click();
  await expect(lastOption).not.toBeChecked();
  await expect(menu.getByRole("checkbox", { name: "AAA", exact: true })).not.toBeChecked();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
});

test("one date or numeric ordering applies at a time while source and date filters stay active", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = [
    {
      ...liveRow("ORDER-A", 1),
      activity_date: "2026-09-03",
      source_amount: "10",
      fee_rate_percent: "10",
      fee_amount: "-10",
      company_amount: "0",
    },
    {
      ...liveRow("ORDER-B", 1),
      activity_date: "2026-09-02",
      source_amount: "20",
      fee_rate_percent: "5",
      fee_amount: "-1",
      company_amount: "19",
    },
    {
      ...liveRow("ORDER-C", 1),
      activity_date: "2026-09-01",
      source_amount: "15",
      fee_rate_percent: "0",
      fee_amount: "0",
      company_amount: "15",
    },
  ];
  await signIn(page);
  await selectOption(page, "Source", "Settlements");
  const dates = await openColumn(page, "Date");
  await dates.getByLabel("From date", { exact: true }).fill("2026-09-01");
  await dates.getByLabel("To date", { exact: true }).fill("2026-09-03");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  for (const [label, ordering, column, direction, firstSku] of [
    ["Reported amount", "Lowest first", "source_amount", "asc", "ORDER-A-001"],
    ["Date", "Oldest first", "activity_date", "asc", "ORDER-C-001"],
  ]) {
    const menu = await openColumn(page, label);
    await menu.getByRole("button", { name: ordering, exact: true }).click();
    await expect(menu).toBeHidden();
    const firstRow = page
      .getByRole("table", { name: "Financial records", exact: true })
      .getByRole("row")
      .nth(1);
    await expect(firstRow.getByRole("cell", { name: firstSku, exact: true })).toBeVisible();
    const params = fixture.requests.at(-1).params;
    expect(params.get("order")).toBe(
      `${column}.${direction}.nullslast,source.asc,source_row_id.asc`,
    );
    expect(params.get("source")).toBe('in.("SETTLEMENT")');
    expect(params.getAll("activity_date")).toEqual(["gte.2026-09-01", "lte.2026-09-03"]);
  }
  const dateMenu = await openColumn(page, "Date");
  await dateMenu.getByRole("button", { name: "Clear dates", exact: true }).click();
  await expect.poll(() => fixture.requests.at(-1).params.getAll("activity_date")).toEqual([]);
  expect(fixture.requests.at(-1).params.get("source")).toBe('in.("SETTLEMENT")');
  expect(fixture.requests.at(-1).params.get("order")).toBe(
    "activity_date.asc.nullslast,source.asc,source_row_id.asc",
  );
});

for (const width of [320, 390]) {
  test(`column option popovers fit a ${width}px screen and selection does not change ordering`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    fixture.liveRows = filteredRows();
    await signIn(page);
    const trigger = page.getByRole("button", { name: "Marketplace", exact: true });
    const menu = await openColumn(page, "Marketplace");
    await expect(menu.getByRole("checkbox", { name: "Amazon.com", exact: true })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    const order = fixture.requests.at(-1).params.get("order");
    await menu.getByRole("checkbox", { name: "Amazon.co.uk", exact: true }).check();
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Financial records", exact: true }).getByRole("row"),
    ).toHaveCount(2);
    expect(fixture.requests.at(-1).params.get("order")).toBe(order);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
