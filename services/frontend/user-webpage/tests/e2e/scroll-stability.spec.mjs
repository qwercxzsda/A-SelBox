import { expect, test } from "@playwright/test";
import { financesRow, liveRow } from "./api-fixtures.mjs";
import { referenceAssignment } from "./assignment-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { item, period, version } from "./sku-configuration-fixtures.mjs";
import {
  adInvoiceRow,
  agedStorageRow,
  openRawData,
  openWorkspaceTab,
  removalOrderRow,
  storageRow,
} from "./raw-data-fixtures.mjs";
import {
  VIEWPORTS,
  clickAt,
  expectListStays,
  expectReserveReleased,
  holdRows,
  listOf,
  menuChoice,
  openColumnMenu,
  placeAt,
  viewportName,
} from "./scroll-stability-actions.mjs";

// Filtering, searching, ordering or paging never moves the list on screen, and the control
// just used stays under the pointer. Only the pager below a list moves to the list's start.
const MARKETPLACES = ["Amazon.com", "Amazon.ca", "Amazon.co.uk", "Amazon.de"];
const CURRENCIES = ["USD", "CAD", "GBP", "EUR"];
const COUNTRIES = ["US", "CA", "GB", "DE"];
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06"];
const COMPANIES = MARKETPLACES.map((_, index) => `0198b50b-701a-7000-8000-00000000010${index}`);
const ROWS = Array.from({ length: 100 }, (_, index) => index);
const TOTAL = ROWS.length;
const padded = (index) => String(index).padStart(3, "0");
/** 25 rows per marketplace and 25 per month, so each filter keeps a quarter of the list. */
const spread = (index) => ({
  marketplace_name: MARKETPLACES[index % 4],
  currency: CURRENCIES[index % 4],
  country_code: COUNTRIES[index % 4],
  month: MONTHS[Math.floor(index / 25)],
  day: `${MONTHS[Math.floor(index / 25)]}-${String((index % 25) + 1).padStart(2, "0")}`,
});
const marketplaceFilter = {
  column: "Marketplace",
  options: ["Amazon.ca", "Amazon.co.uk", "Amazon.de"],
  rows: 25,
  empty: "Amazon.se",
};
const april = { from: "2026-04-01", to: "2026-04-30", rows: 25 };

const TABS = [
  {
    tab: "Transactions",
    dataset: "live",
    setup: (fixture) => {
      fixture.liveRows = ROWS.map((index) => ({
        ...liveRow("ALPHA", index + 1),
        marketplace_name: spread(index).marketplace_name,
        activity_date: spread(index).day,
      }));
    },
    filter: marketplaceFilter,
    dates: { column: "Date (UTC)", ...april },
    sort: { column: "Date (UTC)", option: "Oldest first" },
    search: { text: "ALPHA-07", rows: 10 },
  },
  {
    tab: "Finances",
    dataset: "finances",
    setup: (fixture) => {
      fixture.financesRows = ROWS.map((index) => ({
        ...financesRow(index + 1),
        marketplace_name: spread(index).marketplace_name,
      }));
    },
    filter: marketplaceFilter,
    sort: { column: "Date (UTC)", option: "Oldest first" },
    search: { text: "FINANCES-7", rows: 11 },
  },
  {
    tab: "Payout reports",
    dataset: "payouts",
    setup: (fixture) => {
      fixture.payoutRows = ROWS.map((index) => {
        const start = new Date(Date.UTC(2024, Math.floor(index / 4), 1)).toISOString();
        return {
          id: `0198b50b-701a-7000-8000-${String(500 + index).padStart(12, "0")}`,
          company_id: "company-member-a",
          marketplace_name: MARKETPLACES[index % 4],
          currency: "USD",
          start_date: start.slice(0, 10),
          end_date: `${start.slice(0, 8)}28`,
          created_at: "2026-09-27T13:20:10Z",
          source_amount: "100",
          fee_amount: "-5",
          company_amount: "95",
        };
      });
    },
    filter: marketplaceFilter,
    month: { column: "Month", label: "Report month", value: "2024-03", rows: 4 },
    sort: { column: "Month", option: "Oldest first" },
    search: { text: "Amazon.ca", rows: 25 },
  },
  {
    tab: "User access",
    table: "User accounts",
    dataset: "accounts",
    setup: (fixture) => {
      for (const index of ROWS) {
        fixture.roles[`user-${String(index)}`] = "member";
        fixture.companyIds[`user-${String(index)}`] = COMPANIES[index % 4];
      }
    },
    filter: { column: "Company", options: ["Company 1", "Company 2", "Company 3"], rows: 25 },
    sort: { column: "Email", option: "Descending" },
    search: { text: "user-1", rows: 11 },
  },
  {
    tab: "Inventory",
    table: "Inventory records",
    setup: async (fixture, page) => {
      await mockInventory(
        page,
        ROWS.map((index) =>
          inventoryRow(`SKU-${padded(index)}`, {
            marketplace_name: MARKETPLACES[index % 4],
            company_id: "company-member-a",
          }),
        ),
      );
    },
    filter: {
      column: "Marketplace",
      options: [/^Amazon\.ca/, /^Amazon\.co\.uk/, /^Amazon\.de/],
      rows: 25,
      empty: /^Amazon\.se/,
    },
    sort: { column: "SKU", option: "Z to A" },
    search: { text: "SKU-01", rows: 10 },
  },
  {
    tab: "Current fees",
    table: "Current fee configurations",
    setup: (fixture) => {
      const items = ROWS.map((index) =>
        item(`SKU-${padded(index)}`, {
          sku_id: version(1000 + index),
          terms_version_id: version(3000 + index),
          company_id: COMPANIES[index % 4],
          periods: [{ ...period(), marketplace_name: MARKETPLACES[index % 4] }],
          requirements: [],
        }),
      );
      fixture.skuConfigurationItems = items;
      fixture.assignments = items.map((row) => ({
        id: row.sku_id,
        sku: row.sku,
        company_id: row.company_id,
        terms_version_id: row.terms_version_id,
      }));
    },
    filter: marketplaceFilter,
    search: { text: "SKU-01", rows: 10 },
  },
  {
    tab: "Assignments",
    table: "Assignments",
    setup: (fixture) => {
      fixture.referenceAssignments = ROWS.map((index) =>
        referenceAssignment(`REF-${padded(index)}`, {
          company_id: COMPANIES[index % 4],
          marketplace_names: [MARKETPLACES[index % 4]],
        }),
      );
    },
    filter: marketplaceFilter,
    search: { text: "REF-01", rows: 10 },
  },
  {
    tab: "Companies",
    table: "Companies",
    setup: (fixture) => {
      for (const index of ROWS)
        fixture.companyNames[`0198b50b-701a-7000-8000-${String(900 + index).padStart(12, "0")}`] =
          `Company ${padded(index)}`;
    },
    sort: { column: "Company", option: "Z to A" },
    search: { text: "Company 01", rows: 10 },
  },
  {
    tab: "Advertising invoice",
    dataset: "ad_invoices",
    setup: (fixture) => {
      fixture.rawRows.ad_invoices = ROWS.map((index) => {
        const { day, marketplace_name, currency } = spread(index);
        return adInvoiceRow(index + 1, { marketplace_name, currency, invoice_date: day });
      });
    },
    filter: marketplaceFilter,
    dates: { column: "Invoice date", ...april },
    sort: { column: "Invoice date", option: "Oldest first" },
    search: { text: "INVOICE-7", rows: 11 },
  },
  {
    tab: "Monthly storage report",
    dataset: "storage",
    setup: (fixture) => {
      fixture.rawRows.storage = ROWS.map((index) => {
        const { month, marketplace_name, currency, country_code } = spread(index);
        return storageRow(index, {
          marketplace_name,
          currency,
          country_code,
          month_of_charge: `${month}-01`,
        });
      });
    },
    filter: marketplaceFilter,
    month: { column: "Month of charge", label: "Month of charge", value: "2026-04", rows: 25 },
    sort: { column: "Month of charge", option: "Oldest first" },
    search: { text: "X000000007", rows: 11 },
  },
  {
    tab: "Aged storage report",
    dataset: "aged_storage",
    setup: (fixture) => {
      fixture.rawRows.aged_storage = ROWS.map((index) => {
        const { month, marketplace_name, currency, country_code } = spread(index);
        return agedStorageRow(index, {
          marketplace_name,
          currency,
          country_code,
          snapshot_month: `${month}-01`,
        });
      });
    },
    filter: marketplaceFilter,
    month: { column: "Snapshot month", label: "Snapshot month", value: "2026-04", rows: 25 },
    sort: { column: "Snapshot month", option: "Oldest first" },
    search: { text: "X000000107", rows: 11 },
  },
  {
    tab: "Removal order report",
    dataset: "removal_orders",
    setup: (fixture) => {
      fixture.rawRows.removal_orders = ROWS.map((index) =>
        removalOrderRow(index, { request_date: spread(index).day }),
      );
    },
    dates: { column: "Request date (UTC)", ...april },
    sort: { column: "Request date (UTC)", option: "Oldest first" },
    search: { text: "REMOVAL-7", rows: 11 },
  },
];
const RAW_SOURCES = new Set([
  "Advertising invoice",
  "Monthly storage report",
  "Aged storage report",
  "Removal order report",
]);

async function openTab(page, config, viewport) {
  await page.setViewportSize(viewport);
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.rawRows = {};
  COMPANIES.forEach((id, index) => {
    fixture.companyNames[id] = `Company ${String(index)}`;
  });
  await config.setup(fixture, page);
  const held = config.dataset ? await holdRows(page, config.dataset) : null;
  await signIn(page);
  if (RAW_SOURCES.has(config.tab)) await openRawData(page, config.tab);
  else if (config.tab !== "Transactions") await openWorkspaceTab(page, config.tab);
  const list = listOf(page, config.table ?? "Financial records");
  await list.toolbar.getByLabel("Rows", { exact: true }).selectOption("100");
  await expect(list.rows).toHaveCount(TOTAL);
  return { list, held };
}

const appliedFilters = (page) => page.getByRole("group", { name: /^Applied .* filters$/ });
const clearFilters = (page) => page.getByRole("button", { name: "Clear filters", exact: true });

async function closeMenu(page, menu) {
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

/**
 * With the list high, mid and low on screen: tick an option, untick it in the still-open menu,
 * then tick it again and remove its chip, all without scrolling. A result not loaded yet is held
 * to measure its loading state; a cached one arrives at once.
 */
async function filterKeepsList(page, list, filter, held) {
  for (const [index, y] of [40, 0.5, 0.9].entries()) {
    await placeAt(page, list.heading, y);
    const menu = await openColumnMenu(list, filter.column);
    const choice = await menuChoice(page, menu, filter.options[index]);
    const also = [menu, choice];
    await expectListStays(list, {
      action: () => clickAt(page, choice),
      rows: filter.rows,
      held,
      also,
    });
    await expectListStays(list, { action: () => clickAt(page, choice), rows: TOTAL, also });
    // High on screen the chips are above the view; only the menu removes the filter there.
    if (y === 40) {
      await closeMenu(page, menu);
      continue;
    }
    await clickAt(page, choice);
    await expect(list.rows).toHaveCount(filter.rows);
    await closeMenu(page, menu);
    await expectListStays(list, {
      action: () => clickAt(page, appliedFilters(page).getByRole("button").first()),
      rows: TOTAL,
    });
    await expect(appliedFilters(page)).toHaveCount(0);
  }
}

/** An empty result, then Clear filters (low on screen) or the empty state's reset (mid-screen). */
async function emptyResultKeepsList(page, list, filter, held) {
  const resets = [
    [0.9, clearFilters(page)],
    [0.5, list.card.locator(".empty-state").getByRole("button")],
  ];
  for (const [index, [y, reset]] of resets.entries()) {
    await placeAt(page, list.heading, y);
    const menu = await openColumnMenu(list, filter.column);
    const choice = await menuChoice(page, menu, filter.empty);
    await expectListStays(list, {
      action: () => clickAt(page, choice),
      rows: 0,
      held: index === 0 ? held : null,
      also: [menu],
    });
    await closeMenu(page, menu);
    await expect(list.card.locator(".empty-state")).toBeVisible();
    await expectListStays(list, { action: () => clickAt(page, reset), rows: TOTAL });
  }
}

/** A date range or month from the column menu, then Clear filters, from mid-screen. */
async function rangeKeepsList(page, list, range, held) {
  await placeAt(page, list.heading, 0.5);
  const menu = await openColumnMenu(list, range.column);
  if (range.value) {
    await menu.getByLabel(range.label, { exact: true }).fill(range.value);
  } else {
    await menu.getByLabel("From date", { exact: true }).fill(range.from);
    await menu.getByLabel("To date", { exact: true }).fill(range.to);
  }
  const apply = menu.getByRole("button", {
    name: range.value ? "Apply month" : "Apply dates",
    exact: true,
  });
  await expectListStays(list, { action: () => clickAt(page, apply), rows: range.rows, held });
  await expect(menu).toBeHidden();
  await expectListStays(list, { action: () => clickAt(page, clearFilters(page)), rows: TOTAL });
}

async function searchKeepsList(page, list, search, held) {
  const box = list.toolbar.getByRole("searchbox");
  const clear = list.toolbar.getByRole("button", { name: "Clear search", exact: true });
  for (const [y, text, rows] of [
    [20, search.text, search.rows],
    [0.5, "no-such-record", 0],
  ]) {
    await placeAt(page, list.toolbar, y);
    await expectListStays(list, {
      action: () => box.pressSequentially(text, { delay: 20 }),
      rows,
      held,
      also: [box],
    });
    if (rows === 0) {
      await expect(list.card.locator(".empty-state")).toBeVisible();
      await expectReserveReleased(page);
      await placeAt(page, list.toolbar, y);
    }
    await expectListStays(list, { action: () => clickAt(page, clear), rows: TOTAL, also: [box] });
  }
}

/** Rows and the pager above the list page in place; the pager below goes to the list's start. */
async function pagingKeepsList(page, list, held) {
  await placeAt(page, list.toolbar, 20);
  const rowsSelect = list.toolbar.getByLabel("Rows", { exact: true });
  await expectListStays(list, {
    action: () => rowsSelect.selectOption("50"),
    rows: 50,
    held,
    also: [rowsSelect],
  });
  // Page 2 loads; page 1 comes back from the cache.
  for (const [step, pageHeld] of [
    ["Next", held],
    ["Previous", null],
  ]) {
    const button = list.toolbar.getByRole("button", { name: step, exact: true });
    await expect(button).toBeEnabled();
    await expectListStays(list, {
      action: () => clickAt(page, button),
      rows: 50,
      held: pageHeld,
      also: [button],
    });
  }
  const bottom = page.getByRole("navigation", { name: /navigation at bottom$/ });
  await placeAt(page, bottom, 0.5);
  await clickAt(page, bottom.getByRole("button", { name: /^Next/ }));
  await expect(list.toolbar.getByLabel("Page number", { exact: true })).toHaveValue("2");
  await expect
    .poll(async () => Math.round((await list.toolbar.boundingBox()).y))
    .toBeGreaterThanOrEqual(15);
  expect(Math.round((await list.toolbar.boundingBox()).y)).toBeLessThanOrEqual(17);
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewportName(viewport)}`, () => {
    test.describe.configure({ timeout: 240_000 });
    for (const config of TABS) {
      test(`${config.tab} keeps the list in place while results change`, async ({ page }) => {
        const { list, held } = await openTab(page, config, viewport);
        if (config.filter) await filterKeepsList(page, list, config.filter, held);
        if (config.filter?.empty) await emptyResultKeepsList(page, list, config.filter, held);
        for (const range of [config.dates, config.month].filter(Boolean))
          await rangeKeepsList(page, list, range, held);
        if (config.sort) {
          await placeAt(page, list.heading, 40);
          const menu = await openColumnMenu(list, config.sort.column);
          const option = menu.getByRole("button", { name: config.sort.option });
          await expectListStays(list, { action: () => clickAt(page, option), rows: TOTAL, held });
          if (await menu.isVisible()) await closeMenu(page, menu);
        }
        await searchKeepsList(page, list, config.search, held);
        await pagingKeepsList(page, list, held);
      });
    }
  });
}
