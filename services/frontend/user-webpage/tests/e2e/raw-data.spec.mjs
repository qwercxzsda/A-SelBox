import { expect, test } from "@playwright/test";
import { test as accessibleTest } from "./accessibility-fixture.mjs";
import { financesRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import {
  adInvoiceLines,
  adInvoiceRow,
  agedStorageRow,
  openRawData,
  removalOrderRow,
  storageRow,
} from "./raw-data-fixtures.mjs";
import { openColumn, selectColumnOptions } from "./table-actions.mjs";

const SOURCES = [
  "Finances",
  "Advertising invoice",
  "Monthly storage report",
  "Aged storage report",
  "Removal order report",
];

async function administrator(page, prepare = () => {}) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  const invoice = adInvoiceRow(1);
  fixture.rawRows = {
    ad_invoices: [invoice, adInvoiceRow(2, { marketplace_name: "Amazon.de", currency: "EUR" })],
    storage: [storageRow(1), storageRow(2, { marketplace_name: "Amazon.de", currency: "EUR" })],
    aged_storage: [agedStorageRow(1)],
    removal_orders: [removalOrderRow(1)],
  };
  fixture.adInvoiceLines = adInvoiceLines(invoice);
  fixture.financesRows = [financesRow(1)];
  prepare(fixture);
  await signIn(page);
  return fixture;
}

const table = (page) => page.getByRole("table", { name: "Financial records", exact: true });
const headers = (page) => table(page).getByRole("columnheader");
const lastRequest = (fixture, dataset) =>
  fixture.requests.findLast((entry) => entry.dataset === dataset);

test("Raw data replaces Finances with Amazon's sources, Finances first", async ({ page }) => {
  const fixture = await administrator(page);
  fixture.financesRows = [{ ...financesRow(1), sku: "OLD-VERSION", is_current: "false" }];
  const workspaceTabs = page.getByRole("tablist", { name: "Workspace data", exact: true });
  await expect(workspaceTabs.getByRole("tab", { name: "Finances", exact: true })).toHaveCount(0);
  await workspaceTabs.getByRole("tab", { name: "Raw data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Raw data", exact: true })).toBeVisible();
  const sources = page.getByRole("tablist", { name: "Raw data sources", exact: true });
  await expect(sources.getByRole("tab")).toHaveText(SOURCES);
  await expect(sources.getByRole("tab", { name: "Finances", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/tab=raw-data&raw=finances/);
  await expect(rowWithSku(page, "OLD-VERSION")).toContainText("Earlier version");
  await expect(page.getByRole("button", { name: /^Find by transaction ID/ })).toBeVisible();

  await page.getByRole("button", { name: "Raw data help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Raw data help", exact: true });
  await expect(help).toContainText("Source records from immutable transaction versions");
  await page.keyboard.press("Escape");
  await sources.getByRole("tab", { name: "Removal order report", exact: true }).click();
  await page.getByRole("button", { name: "Raw data help", exact: true }).click();
  await expect(help).toContainText("The removal fee includes tax.");
});

test("each source's page summary counts what one of its rows is, in Amazon's terms", async ({
  page,
}) => {
  await administrator(page);
  const summary = page.locator(".table-toolbar .pagination-summary");
  for (const [source, count] of [
    ["Finances", "1 breakdown"],
    ["Advertising invoice", "1–2 of 2 invoices"],
    ["Monthly storage report", "1–2 of 2 storage fees"],
    ["Aged storage report", "1 aged storage fee"],
    ["Removal order report", "1 removal order line"],
  ]) {
    await openRawData(page, source);
    await expect(summary).toHaveText(count);
  }
});

test("each report lists Amazon's columns with exact amounts and opens its record drawer", async ({
  page,
}) => {
  const fixture = await administrator(page);
  for (const [source, expectedHeaders, firstRow, title, context, fact, calculated, region] of [
    [
      "Monthly storage report",
      [
        "Month of charge",
        "Marketplace",
        "FNSKU",
        "ASIN",
        "Fulfillment center",
        "Average quantity on hand",
        "Estimated monthly storage fee",
      ],
      [
        "July 2026",
        "Amazon.com",
        "X000000001",
        "B000000001",
        "'PHX7'",
        "61.97",
        "0.0123 USD",
        "Tax included: 0.00 USD",
      ],
      "Monthly storage fee details",
      "X000000001 · Amazon.com · July 2026",
      ["Country code", "US"],
      ["Inventory ledger months", "July 2026 – August 2026"],
      "North America",
    ],
    [
      "Aged storage report",
      [
        "Snapshot month",
        "Marketplace",
        "SKU (as printed)",
        "FNSKU",
        "ASIN",
        "Age tier",
        "Quantity charged",
        "Amount charged",
      ],
      [
        "July 2026",
        "Amazon.com.au",
        "AGED-SKU-1",
        "X000000101",
        "365+",
        "0.12 AUD",
        "Tax added: 0.012 AUD",
      ],
      "Aged storage fee details",
      "X000000101 · Amazon.com.au · July 2026",
      ["Snapshot date (UTC)", "2026-07-14 15:00:00"],
      ["Tax added", "0.012 AUD"],
      "Australia",
    ],
    [
      "Removal order report",
      [
        "Request date (UTC)",
        "Order ID",
        "Region",
        "Order type",
        "Order status",
        "SKU (as printed)",
        "FNSKU",
        "Disposition",
        "Requested quantity",
        "Removal fee",
      ],
      [
        "2026-06-22",
        "REMOVAL-1",
        "Japan",
        "Disposal",
        "Completed",
        "REMOVAL-SKU-1",
        "Sellable",
        "Disposed: 2",
        "55 JPY",
        "Tax included: 5 JPY",
      ],
      "Removal order details",
      "REMOVAL-1 · X000000201 · Sellable · Japan",
      ["In-process quantity", "1"],
      ["Tax included", "5 JPY"],
      "Japan",
    ],
  ]) {
    await openRawData(page, source);
    await expect(headers(page)).toHaveText(
      expectedHeaders.map((label) => new RegExp(`^${label.replace(/[()]/g, "\\$&")}`)),
    );
    await expect(headers(page).filter({ hasText: "Seller account" })).toHaveCount(0);
    const row = table(page).getByRole("row").nth(1);
    for (const value of firstRow) await expect(row).toContainText(value);
    await row.click();
    const drawer = page.getByRole("dialog", { name: title, exact: true });
    await expect(drawer.locator(".detail-drawer-context")).toHaveText(context);
    const field = (scope, label) =>
      scope.locator(".detail-field").filter({ hasText: label }).locator(".field-value");
    await expect(field(drawer, fact[0])).toHaveText(fact[1]);
    // Amazon prints no marketplace, base, tax or ledger months: SelBox's own section holds them.
    const calculations = drawer.getByRole("region", { name: "Calculated by SelBox", exact: true });
    await expect(field(calculations, calculated[0])).toHaveText(calculated[1]);
    await expect(field(calculations, fact[0])).toHaveCount(0);
    await drawer.getByRole("button", { name: "Additional details", exact: true }).click();
    const metadata = drawer.getByRole("table", { name: "Additional record details", exact: true });
    await expect(metadata).toContainText("Seller account");
    await expect(metadata).toContainText("synthetic-seller");
    await expect(
      metadata.getByRole("row", { name: `Region ${region}`, exact: true }),
    ).toBeVisible();
    await expect(metadata).toContainText("SelBox row");
    await expect(metadata).not.toContainText("Row number");
    await drawer.getByRole("button", { name: `Close ${title.toLowerCase()}`, exact: true }).click();
    await expect(drawer).toBeHidden();
  }
  expect(
    fixture.requests.filter((entry) => entry.endpoint?.startsWith("/rest/v1/current_")).length,
  ).toBeGreaterThanOrEqual(3);
});

test("a monthly storage row shows Amazon's quantity, volume and rate in the form printed", async ({
  page,
}) => {
  await administrator(page, (fixture) => {
    fixture.rawRows.storage = [
      storageRow(1),
      storageRow(2, {
        amazon_scope: "SINGAPORE",
        marketplace_name: "Amazon.sg",
        country_code: "SG",
        volume_units: "cubic meters",
        estimated_total_item_volume: "8.0E-4",
        storage_rate: "13.2",
        base_rate: null,
        utilization_surcharge_rate: null,
        storage_utilization_ratio: null,
        est_vol_for_sus: null,
        est_base_msf: null,
        est_sus: null,
        currency: "SGD",
      }),
    ];
  });
  await openRawData(page, "Monthly storage report");
  const facts = (grid) =>
    grid
      .locator(".detail-field")
      .evaluateAll((fields) =>
        fields.map((field) => [
          field.querySelector(".field-label")?.textContent,
          field.querySelector(".field-value")?.textContent,
        ]),
      );
  const drawer = page.getByRole("dialog", { name: "Monthly storage fee details", exact: true });
  for (const [fnsku, expected] of [
    [
      "X000000001",
      [
        ["Product size tier", "Standard-Size"],
        ["Average quantity on hand", "61.97"],
        ["Estimated total item volume", "0.0158 cubic feet"],
        ["Month of charge", "July 2026"],
        ["Storage utilization ratio", "9.2 weeks"],
        ["Base rate", "0.78 USD per cubic foot"],
        ["Utilization surcharge rate", "0 USD per cubic foot"],
        ["Estimated volume for surcharge", "0.0051 cubic feet"],
        ["Estimated base storage fee", "0.0123 USD"],
        ["Estimated utilization surcharge", "0.00 USD"],
      ],
    ],
    [
      "X000000002",
      [
        ["Product size tier", "Standard-Size"],
        ["Average quantity on hand", "61.97"],
        ["Estimated total item volume", "0.0008 cubic meters"],
        ["Month of charge", "July 2026"],
        ["Storage rate", "13.2 SGD per cubic meter"],
      ],
    ],
  ]) {
    await table(page).getByRole("row").filter({ hasText: fnsku }).click();
    // Amazon's printed fields come first, before SelBox's own section.
    const printed = await facts(drawer.locator(".detail-grid").first());
    expect(printed.filter(([label]) => expected.some(([want]) => want === label))).toEqual(
      expected,
    );
    await drawer
      .getByRole("button", { name: "Close monthly storage fee details", exact: true })
      .click();
    await expect(drawer).toBeHidden();
  }
});

test("a monthly storage row with both rate forms fails the page instead of showing it", async ({
  page,
}) => {
  await administrator(page, (fixture) => {
    fixture.rawRows.storage = [storageRow(1, { storage_rate: "13.2" })];
  });
  await openRawData(page, "Monthly storage report");
  const alert = page.getByRole("alert").filter({ hasText: "Could not load storage fees" });
  await expect(alert).toContainText("A monthly storage row states its rate in both forms.");
  await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(table(page).getByRole("row").filter({ hasText: "X000000001" })).toHaveCount(0);
});

test("an advertising invoice opens its lines in Amazon's order with exact totals", async ({
  page,
}) => {
  const fixture = await administrator(page);
  await openRawData(page, "Advertising invoice");
  await expect(headers(page)).toHaveText([
    /^Invoice date/,
    /^Invoice ID/,
    /^Marketplace/,
    /^Billing period/,
    /^Status/,
    /^Lines/,
    /^Amount due/,
  ]);
  const row = table(page).getByRole("row").filter({ hasText: "INVOICE-1" });
  for (const value of [
    "2026-09-01",
    "2026-08-01 – 2026-08-31",
    "Paid in full",
    "3.50 USD",
    "Tax due: 0.35 USD",
  ])
    await expect(row).toContainText(value);
  await row.click();
  const drawer = page.getByRole("dialog", { name: "Advertising invoice details", exact: true });
  await expect(drawer.locator(".detail-drawer-context")).toHaveText("INVOICE-1 · Amazon.com");
  const lines = drawer.getByRole("table", { name: "Invoice lines", exact: true });
  await expect(lines.getByRole("row")).toHaveCount(4);
  await expect(lines.getByRole("row").nth(1)).toContainText("Sponsored Products");
  await expect(lines.getByRole("row").nth(2)).toContainText("Account adjustment · Rounding");
  await expect(lines.getByRole("row").last()).toHaveText(/^Total.*3\.50.*0\.35$/);
  await expect(lines.getByRole("columnheader").last()).toHaveText("Tax, calculated (USD)");
  const calculations = drawer.getByRole("region", { name: "Calculated by SelBox", exact: true });
  await expect(calculations).toContainText("Tax rate10%");
  await expect(drawer.locator(".detail-field").first()).toContainText("Invoice ID");
  const linesRequest = lastRequest(fixture, "ad_invoice_lines");
  expect(linesRequest.params.get("version_id")).toBe(`eq.${adInvoiceRow(1).version_id}`);
  expect(linesRequest.params.get("order")).toBe("line_number.asc");
});

test("removal rows of one order and FNSKU differ by disposition and show what the order did", async ({
  page,
}) => {
  // Administrators' SKU options are the catalog; only an exact catalog SKU links to Transactions.
  const fixture = await administrator(page, (prepared) => {
    prepared.skuOptions = ["REMOVAL-SKU-1"];
  });
  fixture.rawRows.removal_orders = [
    removalOrderRow(1, { disposition: "Unsellable", requested_quantity: "5" }),
    removalOrderRow(1, { id: "01910000-0000-7000-8000-000000000399" }),
    removalOrderRow(3, {
      order_type: "Return",
      amazon_scope: "NA",
      disposed_quantity: null,
      shipped_quantity: "4",
      currency: "USD",
      fee_amount: "1.04",
      base_amount: "1.04",
      tax_amount: "0",
    }),
  ];
  await openRawData(page, "Removal order report");
  await expect
    .poll(() => lastRequest(fixture, "removal_orders").params.get("order"))
    .toBe(
      "request_date.desc.nullslast,removal_order_id.asc,fnsku.asc,disposition.asc.nullslast,id.asc",
    );
  const rows = table(page).getByRole("row");
  await expect(rows).toHaveCount(4);
  const cells = (index, column) => rows.nth(index).locator(`[data-column="${column}"]`);
  await expect(cells(1, "disposition")).toHaveText("Sellable");
  await expect(cells(2, "disposition")).toHaveText("Unsellable");
  await expect(cells(3, "amazon_scope")).toHaveText("North America");
  await expect(cells(3, "requested_quantity")).toHaveText("3Shipped: 4");
  await expect(cells(3, "fee_amount")).toHaveText("1.04 USDTax included: 0.00 USD");

  const drawer = page.getByRole("dialog", { name: "Removal order details", exact: true });
  await rows.nth(3).click();
  await expect(drawer.locator(".detail-drawer-context")).toHaveText(
    "REMOVAL-3 · X000000203 · Sellable · North America",
  );
  // A printed SKU that is not a catalog SKU stays plain text.
  await expect(drawer.getByText("REMOVAL-SKU-3", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Show transactions for/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close removal order details", exact: true }).click();

  await rows.nth(2).click();
  await expect(drawer.locator(".detail-drawer-context")).toHaveText(
    "REMOVAL-1 · X000000201 · Unsellable · Japan",
  );
  await drawer.getByRole("button", { name: "Show transactions for REMOVAL-SKU-1" }).click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("group", { name: "Applied table filters", exact: true }),
  ).toContainText("SKU: REMOVAL-SKU-1");
});

test("unknown Amazon codes fail loudly instead of showing as if known", async ({ page }) => {
  const fixture = await administrator(page);
  fixture.rawRows.ad_invoices = [adInvoiceRow(1, { invoice_status: "ISSUED" })];
  await openRawData(page, "Advertising invoice");
  await expect(page.getByRole("alert")).toContainText("Unknown advertising invoice status ISSUED");
  await expect(table(page).getByRole("row").filter({ hasText: "INVOICE-1" })).toHaveCount(0);

  fixture.rawRows.ad_invoices = [adInvoiceRow(1)];
  fixture.adInvoiceLines = adInvoiceLines(adInvoiceRow(1)).map((line) =>
    line.ad_program ? { ...line, ad_program: "SPONSORED_RADIO" } : line,
  );
  await page.reload();
  await table(page).getByRole("row").filter({ hasText: "INVOICE-1" }).click();
  const drawer = page.getByRole("dialog", { name: "Advertising invoice details", exact: true });
  await expect(drawer.getByRole("alert")).toContainText("Unknown ad program SPONSORED_RADIO");
  await expect(drawer.getByRole("table", { name: "Invoice lines", exact: true })).toHaveCount(0);
});

test("filters and search send each view's own columns, and chips name them", async ({ page }) => {
  const fixture = await administrator(page);
  await openRawData(page, "Monthly storage report");
  await selectColumnOptions(page, "Marketplace", ["Amazon.de"]);
  await expect
    .poll(() => lastRequest(fixture, "storage").params.get("marketplace_name"))
    .toBe('in.("Amazon.de")');
  await expect(table(page).getByRole("row")).toHaveCount(2);
  const month = await openColumn(page, "Month of charge");
  await month.getByLabel("Month of charge", { exact: true }).fill("2026-07");
  await month.getByRole("button", { name: "Apply month", exact: true }).click();
  await expect
    .poll(() => lastRequest(fixture, "storage").params.getAll("month_of_charge"))
    .toEqual(["gte.2026-07-01", "lte.2026-07-01"]);
  const chips = page.getByRole("group", { name: "Applied table filters", exact: true });
  await expect(chips).toContainText("Month of charge: July 2026");
  await expect(chips).toContainText("2 filters applied");
  await expect(chips).toContainText("Marketplace: Amazon.de");
  await page.getByLabel("Search", { exact: true }).fill("X000000002");
  await expect
    .poll(() => lastRequest(fixture, "storage").params.get("or"))
    .toBe('(fnsku.imatch."X000000002",asin.imatch."X000000002")');

  await openRawData(page, "Advertising invoice");
  const dates = await openColumn(page, "Invoice date");
  await dates.getByLabel("From date", { exact: true }).fill("2026-09-02");
  await dates.getByLabel("To date", { exact: true }).fill("2026-09-30");
  await dates.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect
    .poll(() => lastRequest(fixture, "ad_invoices").params.getAll("invoice_date"))
    .toEqual(["gte.2026-09-02", "lte.2026-09-30"]);
  await expect(chips).toContainText("Invoice date: 2026-09-02 – 2026-09-30");
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await expect(table(page)).toContainText("INVOICE-2");
  await page.getByLabel("Search", { exact: true }).fill("INVOICE-404");
  await expect(page.getByText("No matching advertising invoices", { exact: true })).toBeVisible();

  // Removal orders name no marketplace, so the Region column offers no marketplace filter.
  await openRawData(page, "Removal order report");
  await expect(page.getByRole("button", { name: /^Region/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Request date \(UTC\)/ })).toBeVisible();
});

test("each source keeps its own list, and a reload restores raw= and row=", async ({ page }) => {
  const fixture = await administrator(page);
  await openRawData(page, "Monthly storage report");
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("X000000002");
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await openRawData(page, "Aged storage report");
  await expect(search).toHaveValue("");
  await openRawData(page, "Monthly storage report");
  await expect(search).toHaveValue("X000000002");
  const selected = (source) =>
    expect(page.getByRole("tab", { name: source, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  await page.goBack();
  await selected("Aged storage report");
  await page.goForward();
  await selected("Monthly storage report");
  await expect(search).toHaveValue("X000000002");

  await table(page).getByRole("row").nth(1).click();
  const drawer = page.getByRole("dialog", { name: "Monthly storage fee details", exact: true });
  await expect(drawer).toBeVisible();
  const rowId = storageRow(2).id;
  await expect(page).toHaveURL(new RegExp(`raw=storage.*row=${rowId}`));
  await page.reload();
  await expect(drawer).toContainText("X000000002");
  await selected("Monthly storage report");
  await expect(search).toHaveValue("X000000002");
  expect(lastRequest(fixture, "storage").user).toBe("member-a");
});

test("members cannot open Raw data through a URL and the views give them nothing", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.rawRows = { storage: [storageRow(1)] };
  await signIn(page);
  await page.goto("/?tab=raw-data&raw=storage");
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Raw data", exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/raw=/);
  expect(
    fixture.requests.filter(({ endpoint }) => endpoint?.startsWith("/rest/v1/current_")),
  ).toEqual([]);
});

test("a reference revision refreshes the open report, and other revisions leave it alone", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await administrator(page);
  await openRawData(page, "Aged storage report");
  await expect(table(page)).toContainText("AGED-SKU-1");
  const reads = () => fixture.requests.filter(({ dataset }) => dataset === "aged_storage").length;
  const polls = () => fixture.revisionRequests.filter(({ completed }) => completed).length;
  const before = reads();
  fixture.rawRows.aged_storage = [agedStorageRow(1, { sku_printed: "AGED-SKU-UPDATED" })];
  let polled = polls();
  fixture.revisions.finances = "1";
  await page.clock.fastForward(60_000);
  await expect.poll(polls).toBeGreaterThan(polled);
  expect(reads()).toBe(before);
  polled = polls();
  fixture.revisions.references = "1";
  await page.clock.fastForward(60_000);
  await expect.poll(polls).toBeGreaterThan(polled);
  await expect(table(page)).toContainText("AGED-SKU-UPDATED");
  expect(reads()).toBeGreaterThan(before);
});

accessibleTest(
  "Raw data sources and the invoice drawer pass the accessibility scan",
  async ({ page, expectAccessible }) => {
    await administrator(page);
    for (const source of SOURCES) {
      await openRawData(page, source);
      await expect(table(page).getByRole("row").nth(1)).toBeVisible();
      await expectAccessible(`raw-data-${source.toLowerCase().replaceAll(" ", "-")}`);
    }
    await openRawData(page, "Advertising invoice");
    await table(page).getByRole("row").filter({ hasText: "INVOICE-1" }).click();
    const drawer = page.getByRole("dialog", { name: "Advertising invoice details", exact: true });
    await expect(drawer.getByRole("table", { name: "Invoice lines", exact: true })).toBeVisible();
    await expectAccessible("raw-data-invoice-drawer");
  },
);
