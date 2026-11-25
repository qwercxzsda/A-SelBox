import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { RAW_DATASETS, decodeRawDataset, isRawReport } from "../src/raw-data-view.ts";
import {
  rawRecordCalculations,
  rawRecordContext,
  rawRecordFields,
  rawRecordSource,
} from "../src/raw-record-fields.ts";
import {
  checkRawReportRow,
  removalQuantityNote,
  reportTaxLabel,
  reportTaxNote,
} from "../src/raw-report-rows.ts";
import { SETTINGS, csvRecord, datasetFilters, pageRequest } from "./api-fixtures.mjs";

const VERSION_ID = "01900000-0000-7000-8000-000000000001";

function recordingClient(body = "id\n") {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method ?? "GET", pathname, params: searchParams });
    return new Response(body, { headers: { "Content-Range": "*/0" } });
  });
  return { client, calls };
}

test("Raw data sub-tabs keep Amazon's sources in order with Finances first", () => {
  assert.deepEqual(RAW_DATASETS, [
    "finances",
    "ad_invoices",
    "storage",
    "aged_storage",
    "removal_orders",
  ]);
  assert.equal(decodeRawDataset("storage"), "storage");
  for (const value of [null, "", "live", "payouts", "STORAGE", 3]) {
    assert.equal(decodeRawDataset(value), "finances");
  }
  assert.equal(isRawReport("finances"), false);
  assert.equal(isRawReport("removal_orders"), true);
  assert.equal(isRawReport("accounts"), false);
});

test("a monthly report reads one month start and marketplaces through REST, page and count alike", async () => {
  const { client, calls } = recordingClient();
  const options = pageRequest("storage", {
    search: "X00*1",
    filters: datasetFilters({
      marketplaces: ["Amazon.de", 'Amazon "quoted"'],
      dateFrom: "2026-07-01",
      dateTo: "2026-07-01",
    }),
  });
  await client.fetchDatasetPage(options);
  await client.fetchDatasetCount(options);
  assert.deepEqual(
    calls.map(({ method, pathname }) => [method, pathname]),
    [
      ["GET", "/rest/v1/current_storage_rows"],
      ["HEAD", "/rest/v1/current_storage_rows"],
    ],
  );
  for (const { params } of calls) {
    assert.equal(params.get("marketplace_name"), 'in.("Amazon.de","Amazon \\"quoted\\"")');
    assert.deepEqual(params.getAll("month_of_charge"), ["gte.2026-07-01", "lte.2026-07-01"]);
    assert.equal(params.get("or"), '(fnsku.imatch."X00\\\\*1",asin.imatch."X00\\\\*1")');
  }
  assert.equal(calls[0].params.get("select"), DATASET_CONFIG.storage.selectColumns.join(","));
  assert.equal(
    calls[0].params.get("order"),
    "month_of_charge.desc.nullslast,marketplace_name.asc,fnsku.asc,fulfillment_center.asc.nullslast,id.asc",
  );
  assert.equal(calls[1].params.get("select"), "id");
});

test("invoices and removal orders filter a day range on their UTC date columns", async () => {
  for (const [dataset, column, endpoint] of [
    ["ad_invoices", "invoice_date", "/rest/v1/current_ad_invoices"],
    ["removal_orders", "request_date", "/rest/v1/current_removal_order_rows"],
  ]) {
    const { client, calls } = recordingClient();
    await client.fetchDatasetPage(
      pageRequest(dataset, {
        filters: datasetFilters({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }),
      }),
    );
    assert.equal(calls[0].pathname, endpoint);
    assert.deepEqual(calls[0].params.getAll(column), ["gte.2026-08-01", "lte.2026-08-31"]);
    assert.equal(calls[0].params.has("marketplace_name"), false);
  }
});

test("removal orders have no marketplace to filter, and unknown sort columns never reach HTTP", async () => {
  const client = createApiClient(SETTINGS, () => assert.fail("Invalid requests must not be sent"));
  await assert.rejects(
    client.fetchDatasetPage(
      pageRequest("removal_orders", { filters: datasetFilters({ marketplaces: ["Amazon.com"] }) }),
    ),
    /cannot be filtered in Removal order report/,
  );
  await assert.rejects(
    client.fetchDatasetPage(
      pageRequest("ad_invoices", { sort: { column: "tax_amount_due", direction: "desc" } }),
    ),
    /Sort column is not allowed/,
  );
});

test("invoice lines are read by version in Amazon's order and must match the invoice's line count", async () => {
  const line = (number, versionId = VERSION_ID, codes = {}) =>
    csvRecord({
      id: `01900000-0000-7000-8000-00000000010${String(number)}`,
      version_id: versionId,
      line_number: String(number),
      line_kind: "CAMPAIGN",
      adjustment_kind: null,
      ad_program: "SPONSORED_PRODUCTS",
      cost_amount: "1.5",
      ...codes,
    });
  const reply = (rows) =>
    new Response([rows[0].split("\n")[0], ...rows.map((row) => row.split("\n")[1])].join("\n"), {
      headers: { "Content-Range": `0-${String(rows.length - 1)}/${String(rows.length)}` },
    });
  const calls = [];
  let rows = [line(1), line(2)];
  const client = createApiClient(SETTINGS, async (url) => {
    calls.push(new URL(url));
    return reply(rows);
  });
  const lines = await client.fetchAdInvoiceLines("token", { versionId: VERSION_ID, lineCount: 2 });
  assert.deepEqual(
    lines.map((row) => row.line_number),
    ["1", "2"],
  );
  assert.equal(calls[0].pathname, "/rest/v1/current_ad_invoice_lines");
  assert.equal(calls[0].searchParams.get("version_id"), `eq.${VERSION_ID}`);
  assert.equal(calls[0].searchParams.get("order"), "line_number.asc");
  await assert.rejects(
    client.fetchAdInvoiceLines("token", { versionId: VERSION_ID, lineCount: 3 }),
    /returned 2 of 3 lines/,
  );
  rows = [line(1), line(2, "01900000-0000-7000-8000-000000000009")];
  await assert.rejects(
    client.fetchAdInvoiceLines("token", { versionId: VERSION_ID, lineCount: 2 }),
    /another invoice version/,
  );
  for (const [codes, error] of [
    [{ ad_program: "SPONSORED_RADIO" }, /Unknown ad program SPONSORED_RADIO/],
    [{ line_kind: "FEE", ad_program: null }, /Unknown invoice line kind FEE/],
    [{ line_kind: "ACCOUNT_ADJUSTMENT", adjustment_kind: "ROUNDING" }, /does not match its kind/],
    [
      { line_kind: "ACCOUNT_ADJUSTMENT", adjustment_kind: "REBATE", ad_program: null },
      /Unknown invoice adjustment REBATE/,
    ],
  ]) {
    rows = [line(1), line(2, VERSION_ID, codes)];
    await assert.rejects(
      client.fetchAdInvoiceLines("token", { versionId: VERSION_ID, lineCount: 2 }),
      error,
    );
  }
  await assert.rejects(
    client.fetchAdInvoiceLines("token", { versionId: "not-a-version", lineCount: 1 }),
    /valid advertising invoice/,
  );
});

test("report drawers list Amazon's printed fields, then SelBox's calculations, with exact amounts", () => {
  const storage = {
    id: "row-1",
    seller_namespace: "seller-a",
    amazon_scope: "SINGAPORE",
    version_id: VERSION_ID,
    processed_at: "2026-08-02T03:04:05Z",
    row_number: "4",
    month_of_charge: "2026-07-01",
    marketplace_name: "Amazon.sg",
    country_code: "SG",
    fulfillment_center: "'SIN8'",
    fnsku: "X000000001",
    asin: "B000000001",
    average_quantity_on_hand: "61.97",
    product_size_tier: "Standard-Size",
    estimated_total_item_volume: "8.0E-4",
    volume_units: "cubic meters",
    storage_rate: "13.2",
    base_rate: null,
    utilization_surcharge_rate: null,
    storage_utilization_ratio: null,
    est_vol_for_sus: null,
    est_base_msf: null,
    est_sus: null,
    currency: "SGD",
    fee_amount: "0.0123",
    base_amount: "0.0123",
    tax_amount: "0.00111",
    ledger_first_month: "2026-07-01",
    ledger_last_month: "2026-08-01",
  };
  const pairs = (fields) => fields.map(({ label, value }) => [label, value]);
  assert.equal(rawRecordContext("storage", storage), "X000000001 · Amazon.sg · July 2026");
  assert.deepEqual(pairs(rawRecordFields("storage", storage)), [
    ["ASIN", "B000000001"],
    ["FNSKU", "X000000001"],
    ["Fulfillment center", "'SIN8'"],
    ["Country code", "SG"],
    ["Product size tier", "Standard-Size"],
    ["Average quantity on hand", "61.97"],
    ["Estimated total item volume", "0.0008 cubic meters"],
    ["Month of charge", "July 2026"],
    ["Storage rate", "13.2 SGD per cubic meter"],
    ["Estimated monthly storage fee", "0.0123 SGD"],
  ]);
  // European, Japanese and North American reports state a base rate and a surcharge rate, with
  // the storage utilization ratio and Amazon's split of the fee.
  const twoRates = {
    ...storage,
    volume_units: "cubic feet",
    storage_rate: null,
    base_rate: "0.78",
    utilization_surcharge_rate: "0.12",
    storage_utilization_ratio: "27.5",
    est_vol_for_sus: "7.0E-4",
    est_base_msf: "0.0062",
    est_sus: "0.0061",
    currency: "USD",
  };
  assert.deepEqual(pairs(rawRecordFields("storage", twoRates)).slice(6), [
    ["Estimated total item volume", "0.0008 cubic feet"],
    ["Month of charge", "July 2026"],
    ["Storage utilization ratio", "27.5 weeks"],
    ["Base rate", "0.78 USD per cubic foot"],
    ["Utilization surcharge rate", "0.12 USD per cubic foot"],
    ["Estimated volume for surcharge", "0.0007 cubic feet"],
    ["Estimated base storage fee", "0.0062 USD"],
    ["Estimated utilization surcharge", "0.0061 USD"],
    ["Estimated monthly storage fee", "0.0123 USD"],
  ]);
  // Amazon prints ">52" when the ratio has no number.
  assert.deepEqual(
    pairs(rawRecordFields("storage", { ...twoRates, storage_utilization_ratio: ">52" }))[8],
    ["Storage utilization ratio", ">52 weeks"],
  );
  assert.deepEqual(pairs(rawRecordCalculations("storage", storage)), [
    ["Marketplace", "Amazon.sg"],
    ["Base amount", "0.0123 SGD"],
    ["Tax added", "0.00111 SGD"],
    ["Inventory ledger months", "July 2026 – August 2026"],
  ]);
  assert.deepEqual(
    rawRecordSource("storage", storage).map(({ field, value }) => [field, value]),
    [
      ["Seller account", "seller-a"],
      ["Region", "Singapore"],
      ["Version ID", VERSION_ID],
      ["SelBox row", "4"],
      ["Record ID", "row-1"],
      ["Processed (UTC)", "2026-08-02 03:04:05"],
    ],
  );
  const invoice = {
    invoice_id: "INVOICE-1",
    invoice_status: "PAID_IN_FULL",
    marketplace_name: "Amazon.sg",
    from_date: "2026-01-24",
    to_date: "2026-02-27",
    currency: "JPY",
    amount_due: "350",
    tax_amount_due: "35",
    tax_rate_percent: "10.00",
    tax_rate_stated: "1000",
  };
  assert.equal(rawRecordContext("ad_invoices", invoice), "INVOICE-1 · Amazon.sg");
  const facts = Object.fromEntries(pairs(rawRecordFields("ad_invoices", invoice)));
  assert.equal(facts.Status, "Paid in full");
  assert.equal(facts["Billing period"], "2026-01-24 – 2026-02-27");
  assert.equal(facts["Amount due"], "350 JPY");
  assert.equal(facts["Tax rate as stated"], "1000");
  assert.equal(facts["Tax name"], "—");
  assert.deepEqual(pairs(rawRecordCalculations("ad_invoices", invoice)), [["Tax rate", "10%"]]);
  assert.equal(
    rawRecordSource("ad_invoices", invoice).some(({ field }) => field === "SelBox row"),
    false,
  );
  const removal = {
    removal_order_id: "REMOVAL-1",
    fnsku: "X1",
    disposition: "Unsellable",
    amazon_scope: "NA",
    currency: "JPY",
    fee_amount: "55",
    base_amount: "50",
    tax_amount: "5",
  };
  assert.equal(
    rawRecordContext("removal_orders", removal),
    "REMOVAL-1 · X1 · Unsellable · North America",
  );
  assert.deepEqual(
    rawRecordCalculations("removal_orders", removal).map(({ label }) => label),
    ["Base amount", "Tax included", "Inventory ledger months"],
  );
  assert.throws(
    () => rawRecordContext("removal_orders", { ...removal, amazon_scope: "FE" }),
    /Unknown Amazon region FE/,
  );
  const zeroFee = {
    ...removal,
    currency: null,
    fee_amount: "0.00",
    base_amount: "0",
    tax_amount: "0",
  };
  assert.equal(
    rawRecordFields("removal_orders", zeroFee).find(({ key }) => key === "fee_amount").value,
    "0",
  );
  assert.deepEqual(
    rawRecordCalculations("removal_orders", zeroFee)
      .slice(0, 2)
      .map(({ value }) => value),
    ["0", "0"],
  );
  // A fee Amazon printed empty stays unknown.
  const noFee = { ...zeroFee, fee_amount: null, base_amount: null, tax_amount: null };
  assert.equal(
    rawRecordFields("removal_orders", noFee).find(({ key }) => key === "fee_amount").value,
    "—",
  );
});

test("a report fee says whether SelBox's tax is inside it or added on top, and nothing else", () => {
  const row = (fee_amount, base_amount, tax_amount, currency = "JPY") => ({
    fee_amount,
    base_amount,
    tax_amount,
    currency,
  });
  assert.equal(reportTaxNote(row("1100", "1000", "100")), "Tax included: 100 JPY");
  assert.equal(reportTaxNote(row("1000", "1000", "100")), "Tax added: 100 JPY");
  assert.equal(reportTaxNote(row("0.12", "0.12", "0.012", "AUD")), "Tax added: 0.012 AUD");
  // Exact decimals: trailing zeros and sub-cent digits compare as numbers, never rounded.
  assert.equal(reportTaxLabel(row("0.0123000", "0.0123", "0")), "Tax included");
  assert.equal(reportTaxLabel(row("-1.10", "-1", "-0.1")), "Tax included");
  assert.equal(reportTaxLabel(row(null, null, null)), null);
  assert.equal(reportTaxNote(row(null, null, null)), null);
  // Amazon prints some zero removal fees without a currency: a known zero, not "—".
  assert.equal(reportTaxNote(row("0.00", "0", "0", null)), "Tax included: 0");
  assert.throws(() => reportTaxLabel(row("1100", "1000", "99.999")), /neither base 1000 plus tax/);
  assert.throws(() => reportTaxLabel(row("55", null, null)), /needs its base and tax/);
});

test("a removal order shows the quantity its order type acts on", () => {
  const row = (order_type) => ({
    order_type,
    disposed_quantity: "2",
    shipped_quantity: "4",
  });
  assert.equal(removalQuantityNote(row("Disposal")), "Disposed: 2");
  assert.equal(removalQuantityNote(row("Return")), "Shipped: 4");
  // Amazon fills shipped-quantity for a Liquidations order, like a Return.
  assert.equal(removalQuantityNote(row("Liquidations")), "Shipped: 4");
  assert.equal(
    removalQuantityNote({ order_type: "Liquidations", shipped_quantity: "0" }),
    "Shipped: 0",
  );
  assert.throws(
    () => removalQuantityNote({ order_type: "Return", shipped_quantity: null }),
    /A Return removal order row has an invalid shipped_quantity/,
  );
  assert.throws(
    () => removalQuantityNote({ order_type: "Disposal", shipped_quantity: "4" }),
    /A Disposal removal order row has an invalid disposed_quantity/,
  );
  assert.throws(() => removalQuantityNote(row("Recall")), /Unknown removal order type Recall/);
});

test("report rows with an unknown region, invoice status or tax split are rejected before display", () => {
  const storage = {
    amazon_scope: "EU",
    average_quantity_on_hand: "2",
    product_size_tier: "Standard-Size",
    estimated_total_item_volume: "0.01",
    volume_units: "cubic meters",
    storage_rate: null,
    base_rate: "26",
    utilization_surcharge_rate: "0",
    storage_utilization_ratio: "18.4",
    est_vol_for_sus: "0.01",
    est_base_msf: "1",
    est_sus: "0",
    currency: "EUR",
    fee_amount: "1",
    base_amount: "1",
    tax_amount: "0.19",
  };
  assert.doesNotThrow(() => checkRawReportRow("storage", storage));
  for (const [change, message] of [
    [{ storage_rate: "13.2" }, /rate in both forms/],
    [{ base_rate: null, utilization_surcharge_rate: null }, /states no storage rate/],
    [
      { storage_rate: "13.2", base_rate: null, utilization_surcharge_rate: null },
      /one-rate monthly storage row states a utilization surcharge/,
    ],
    [{ storage_utilization_ratio: null }, /invalid storage_utilization_ratio/],
    [{ storage_utilization_ratio: "52+" }, /invalid storage_utilization_ratio/],
    [{ est_vol_for_sus: null }, /invalid est_vol_for_sus/],
    [{ est_base_msf: "-1" }, /invalid est_base_msf/],
    [{ est_sus: null }, /invalid est_sus/],
    [{ utilization_surcharge_rate: null }, /invalid utilization_surcharge_rate/],
    [{ base_rate: "-1" }, /invalid base_rate/],
    [{ average_quantity_on_hand: null }, /invalid average_quantity_on_hand/],
    [{ average_quantity_on_hand: "NaN" }, /invalid average_quantity_on_hand/],
    [{ estimated_total_item_volume: "-0.1" }, /invalid estimated_total_item_volume/],
    [{ volume_units: "liters" }, /Unknown storage volume unit liters/],
    [{ product_size_tier: " " }, /no product size tier/],
  ])
    assert.throws(() => checkRawReportRow("storage", { ...storage, ...change }), message);
  assert.throws(
    () => checkRawReportRow("storage", { ...storage, amazon_scope: "na" }),
    /region na/,
  );
  assert.throws(
    () => checkRawReportRow("aged_storage", { ...storage, tax_amount: "0.2", base_amount: "0.9" }),
    /neither base/,
  );
  const invoice = { amazon_scope: "JAPAN", invoice_status: "PAID_IN_FULL" };
  assert.doesNotThrow(() => checkRawReportRow("ad_invoices", invoice));
  assert.throws(
    () => checkRawReportRow("ad_invoices", { ...invoice, invoice_status: "ISSUED" }),
    /Unknown advertising invoice status ISSUED/,
  );
  const removal = {
    amazon_scope: "AUSTRALIA",
    order_type: "Disposal",
    disposed_quantity: "2",
    fee_amount: "1",
    base_amount: "1",
    tax_amount: "0.19",
  };
  assert.doesNotThrow(() => checkRawReportRow("removal_orders", removal));
  assert.throws(
    () => checkRawReportRow("removal_orders", { ...removal, order_type: "Recall" }),
    /Unknown removal order type/,
  );
  assert.throws(
    () => checkRawReportRow("removal_orders", { ...removal, order_type: "Liquidations" }),
    /invalid shipped_quantity/,
  );
});

test("a report page with a row outside the observed rules fails instead of showing it", async () => {
  const body = csvRecord({
    ...Object.fromEntries(DATASET_CONFIG.storage.selectColumns.map((column) => [column, null])),
    id: "01910000-0000-7000-8000-000000000001",
    amazon_scope: "NA",
    fee_amount: "1.10",
    base_amount: "1",
    tax_amount: "0.05",
  });
  const client = createApiClient(
    SETTINGS,
    async () => new Response(body, { headers: { "Content-Range": "0-0/1" } }),
  );
  await assert.rejects(client.fetchDatasetPage(pageRequest("storage")), /neither base 1 plus tax/);
});
