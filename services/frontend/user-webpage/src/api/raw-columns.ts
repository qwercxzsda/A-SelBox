// Columns of the administrator views of Amazon reports, exactly as the views name them.
// Each view holds the current version only; seller account and region identify the source.

const SOURCE_COLUMNS = [
  "id",
  "seller_namespace",
  "amazon_scope",
  "version_id",
  "processed_at",
] as const;
const AMOUNT_COLUMNS = ["currency", "fee_amount", "base_amount", "tax_amount"] as const;
const LEDGER_COLUMNS = ["ledger_first_month", "ledger_last_month"] as const;

export const AD_INVOICE_COLUMNS = [
  ...SOURCE_COLUMNS,
  "invoice_id",
  "profile_id",
  "marketplace_name",
  "invoice_status",
  "invoice_date",
  "from_date",
  "to_date",
  "currency",
  "amount_due",
  "tax_amount_due",
  "tax_name",
  "tax_country",
  "tax_rate_stated",
  "tax_rate_percent",
  "line_count",
] as const;

/** One invoice's lines, read by version_id for the invoice drawer. */
export const AD_INVOICE_LINE_COLUMNS = [
  "id",
  "version_id",
  "line_number",
  "line_kind",
  "adjustment_kind",
  "campaign_id",
  "campaign_aid",
  "campaign_name",
  "ad_program",
  "description",
  "currency",
  "cost_amount",
  "base_amount",
  "tax_amount",
] as const;

export const STORAGE_COLUMNS = [
  ...SOURCE_COLUMNS,
  "row_number",
  "month_of_charge",
  "marketplace_name",
  "country_code",
  "fulfillment_center",
  "fnsku",
  "asin",
  "average_quantity_on_hand",
  "product_size_tier",
  "estimated_total_item_volume",
  "volume_units",
  // One rate form is set: storage_rate, or base_rate with utilization_surcharge_rate.
  "storage_rate",
  "base_rate",
  "utilization_surcharge_rate",
  // Only the two-rate form has the utilization ratio and Amazon's split of the fee.
  "storage_utilization_ratio",
  "est_vol_for_sus",
  "est_base_msf",
  "est_sus",
  ...AMOUNT_COLUMNS,
  ...LEDGER_COLUMNS,
] as const;

export const AGED_STORAGE_COLUMNS = [
  ...SOURCE_COLUMNS,
  "row_number",
  "snapshot_at",
  "snapshot_month",
  "marketplace_name",
  "country_code",
  "fnsku",
  "asin",
  "sku_printed",
  "condition",
  "age_tier",
  "quantity_charged",
  ...AMOUNT_COLUMNS,
  ...LEDGER_COLUMNS,
] as const;

export const REMOVAL_ORDER_COLUMNS = [
  ...SOURCE_COLUMNS,
  "row_number",
  "removal_order_id",
  "requested_at",
  "request_date",
  "last_updated_at",
  "order_type",
  "order_status",
  "fnsku",
  "sku_printed",
  "disposition",
  "requested_quantity",
  "cancelled_quantity",
  "disposed_quantity",
  "shipped_quantity",
  "in_process_quantity",
  ...AMOUNT_COLUMNS,
  ...LEDGER_COLUMNS,
] as const;
