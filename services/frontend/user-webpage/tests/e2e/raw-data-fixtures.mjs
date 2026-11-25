import { expect } from "@playwright/test";

const versionId = (index) => `01900000-0000-7000-8000-${String(index).padStart(12, "0")}`;

function source(index, seller = "synthetic-seller", region = "NA") {
  return {
    id: `01910000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    seller_namespace: seller,
    amazon_scope: region,
    version_id: versionId(index),
    processed_at: "2026-09-02T03:04:05Z",
  };
}

const ledger = { ledger_first_month: "2026-07-01", ledger_last_month: "2026-08-01" };

export function adInvoiceRow(index, overrides = {}) {
  const base = source(index);
  return {
    ...base,
    id: base.version_id,
    invoice_id: `INVOICE-${String(index)}`,
    profile_id: `PROFILE-${String(index)}`,
    marketplace_name: "Amazon.com",
    invoice_status: "PAID_IN_FULL",
    invoice_date: `2026-09-${String(index).padStart(2, "0")}`,
    from_date: "2026-08-01",
    to_date: "2026-08-31",
    currency: "USD",
    amount_due: "3.50",
    tax_amount_due: "0.35",
    tax_name: "VAT",
    tax_country: "SINGAPORE",
    tax_rate_stated: "1000",
    tax_rate_percent: "10.00",
    line_count: "2",
    ...overrides,
  };
}

export function adInvoiceLines(invoice) {
  return [
    {
      id: invoice.version_id.replace(/^01900000/, "01930001"),
      version_id: invoice.version_id,
      line_number: "1",
      line_kind: "CAMPAIGN",
      adjustment_kind: null,
      campaign_id: "CAMPAIGN-1",
      campaign_aid: "CAMPAIGN-AID-1",
      campaign_name: "Fixture campaign",
      ad_program: "SPONSORED_PRODUCTS",
      description: null,
      currency: invoice.currency,
      cost_amount: "3.51",
      base_amount: "3.51",
      tax_amount: "0.351",
    },
    {
      id: invoice.version_id.replace(/^01900000/, "01930002"),
      version_id: invoice.version_id,
      line_number: "2",
      line_kind: "ACCOUNT_ADJUSTMENT",
      adjustment_kind: "ROUNDING",
      campaign_id: null,
      campaign_aid: null,
      campaign_name: null,
      ad_program: null,
      description: "Rounding Adjustment",
      currency: invoice.currency,
      cost_amount: "-0.01",
      base_amount: "-0.01",
      tax_amount: "-0.001",
    },
  ];
}

export function storageRow(index, overrides = {}) {
  return {
    ...source(100 + index),
    row_number: String(index),
    month_of_charge: "2026-07-01",
    marketplace_name: "Amazon.com",
    country_code: "US",
    fulfillment_center: "'PHX7'",
    fnsku: `X00000000${String(index)}`,
    asin: `B00000000${String(index)}`,
    // North American reports state a base rate, a utilization surcharge rate, the storage
    // utilization ratio and Amazon's split of the fee.
    average_quantity_on_hand: "61.97",
    product_size_tier: "Standard-Size",
    estimated_total_item_volume: "0.0158",
    volume_units: "cubic feet",
    storage_rate: null,
    base_rate: "0.78",
    utilization_surcharge_rate: "0",
    storage_utilization_ratio: "9.2",
    est_vol_for_sus: "0.0051",
    est_base_msf: "0.0123",
    est_sus: "0",
    currency: "USD",
    fee_amount: "0.0123",
    base_amount: "0.0123",
    tax_amount: "0",
    ...ledger,
    ...overrides,
  };
}

export function agedStorageRow(index, overrides = {}) {
  return {
    ...source(200 + index, "synthetic-seller", "AUSTRALIA"),
    row_number: String(index),
    snapshot_at: "2026-07-14T15:00:00Z",
    snapshot_month: "2026-07-01",
    marketplace_name: "Amazon.com.au",
    country_code: "AU",
    fnsku: `X00000010${String(index)}`,
    asin: `B00000010${String(index)}`,
    sku_printed: `AGED-SKU-${String(index)}`,
    condition: "New",
    age_tier: "365+",
    quantity_charged: "1",
    currency: "AUD",
    fee_amount: "0.12",
    base_amount: "0.12",
    tax_amount: "0.012",
    ...ledger,
    ...overrides,
  };
}

export function removalOrderRow(index, overrides = {}) {
  return {
    ...source(300 + index, "synthetic-seller", "JAPAN"),
    row_number: String(index),
    removal_order_id: `REMOVAL-${String(index)}`,
    requested_at: "2026-06-22T07:00:34Z",
    request_date: "2026-06-22",
    last_updated_at: "2026-06-24T09:41:04Z",
    order_type: "Disposal",
    order_status: "Completed",
    fnsku: `X00000020${String(index)}`,
    sku_printed: `REMOVAL-SKU-${String(index)}`,
    disposition: "Sellable",
    requested_quantity: "3",
    cancelled_quantity: "0",
    disposed_quantity: "2",
    shipped_quantity: null,
    in_process_quantity: "1",
    currency: "JPY",
    fee_amount: "55",
    base_amount: "50",
    tax_amount: "5",
    ...ledger,
    ...overrides,
  };
}

/** Open Raw data and one of its sources; Finances is the default source. */
export async function openRawData(page, source = "Finances") {
  await page.getByRole("tab", { name: "Raw data", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Raw data sources", exact: true })
    .getByRole("tab", { name: source, exact: true })
    .click();
  await expect(page.getByRole("tab", { name: source, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** Open a workspace tab by its label. Finances is a Raw data source, not a workspace tab. */
export async function openWorkspaceTab(page, label) {
  if (label === "Finances") await openRawData(page);
  else await page.getByRole("tab", { name: label, exact: true }).click();
}
