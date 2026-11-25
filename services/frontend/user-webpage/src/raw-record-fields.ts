import type { CanonicalRow, RawReportKey } from "./api/types.ts";
import { invoiceStatusLabel, regionLabel } from "./amazon-codes.ts";
import { formatRecordDate, formatRecordMonth } from "./date-display.ts";
import { formatExactDecimal, formatExactMoney } from "./decimal.ts";
import { reportTaxLabel, storageFeeBasis, storageVolume } from "./raw-report-rows.ts";

export interface RawRecordField {
  key: string;
  label: string;
  value: string;
}

const EMPTY = "—";

export const RAW_RECORD_TITLES: Record<RawReportKey, string> = {
  ad_invoices: "Advertising invoice details",
  storage: "Monthly storage fee details",
  aged_storage: "Aged storage fee details",
  removal_orders: "Removal order details",
};

const text = (row: CanonicalRow, key: string) => row[key] ?? EMPTY;
const money = (row: CanonicalRow, key: string) =>
  formatExactMoney(row[key] ?? null, row.currency ?? null);
const quantity = (row: CanonicalRow, key: string) => formatExactDecimal(row[key] ?? null);
const month = (row: CanonicalRow, key: string) => {
  const value = row[key];
  return value ? formatRecordMonth(value) : EMPTY;
};
const timestamp = (row: CanonicalRow, key: string) => {
  const value = row[key];
  return value ? formatRecordDate(value, { includeTimeZone: false }) : EMPTY;
};
const span = (start: string, end: string) => (start === end ? start : `${start} – ${end}`);

/** "identity · scope" for the drawer heading. */
export function rawRecordContext(dataset: RawReportKey, row: CanonicalRow): string {
  const parts = {
    ad_invoices: [row.invoice_id, row.marketplace_name],
    storage: [
      row.fnsku,
      row.marketplace_name,
      row.month_of_charge && month(row, "month_of_charge"),
    ],
    aged_storage: [
      row.fnsku,
      row.marketplace_name,
      row.snapshot_month && month(row, "snapshot_month"),
    ],
    removal_orders: [
      row.removal_order_id,
      row.fnsku,
      row.disposition,
      row.amazon_scope && regionLabel(row.amazon_scope),
    ],
  }[dataset];
  return parts.filter(Boolean).join(" · ");
}

type Entry = [key: string, label: string, value: string];

function toFields(entries: Entry[]): RawRecordField[] {
  return entries.map(([key, label, value]) => ({ key, label, value }));
}

/** The fields Amazon printed on one report row, in its column order. */
export function rawRecordFields(dataset: RawReportKey, row: CanonicalRow): RawRecordField[] {
  switch (dataset) {
    case "ad_invoices":
      return toFields([
        ["invoice_id", "Invoice ID", text(row, "invoice_id")],
        ["invoice_status", "Status", invoiceStatusLabel(text(row, "invoice_status"))],
        ["invoice_date", "Invoice date", text(row, "invoice_date")],
        ["billing_period", "Billing period", span(text(row, "from_date"), text(row, "to_date"))],
        ["amount_due", "Amount due", money(row, "amount_due")],
        ["tax_amount_due", "Tax due", money(row, "tax_amount_due")],
        ["tax_rate_stated", "Tax rate as stated", text(row, "tax_rate_stated")],
        ["tax_name", "Tax name", text(row, "tax_name")],
        ["tax_country", "Tax country", text(row, "tax_country")],
        ["marketplace_name", "Marketplace", text(row, "marketplace_name")],
        ["profile_id", "Profile ID", text(row, "profile_id")],
      ]);
    case "storage":
      return toFields([
        ["asin", "ASIN", text(row, "asin")],
        ["fnsku", "FNSKU", text(row, "fnsku")],
        ["fulfillment_center", "Fulfillment center", text(row, "fulfillment_center")],
        ["country_code", "Country code", text(row, "country_code")],
        ["product_size_tier", "Product size tier", text(row, "product_size_tier")],
        [
          "average_quantity_on_hand",
          "Average quantity on hand",
          quantity(row, "average_quantity_on_hand"),
        ],
        ["estimated_total_item_volume", "Estimated total item volume", storageVolume(row)],
        ["month_of_charge", "Month of charge", month(row, "month_of_charge")],
        ...storageFeeBasis(row),
        ["fee_amount", "Estimated monthly storage fee", money(row, "fee_amount")],
      ]);
    case "aged_storage":
      return toFields([
        ["snapshot_at", "Snapshot date (UTC)", timestamp(row, "snapshot_at")],
        ["sku_printed", "SKU (as printed)", text(row, "sku_printed")],
        ["fnsku", "FNSKU", text(row, "fnsku")],
        ["asin", "ASIN", text(row, "asin")],
        ["condition", "Condition", text(row, "condition")],
        ["country_code", "Country code", text(row, "country_code")],
        ["quantity_charged", "Quantity charged", quantity(row, "quantity_charged")],
        ["fee_amount", "Amount charged", money(row, "fee_amount")],
        ["age_tier", "Age tier", text(row, "age_tier")],
      ]);
    case "removal_orders":
      return toFields([
        ["requested_at", "Request date (UTC)", timestamp(row, "requested_at")],
        ["removal_order_id", "Order ID", text(row, "removal_order_id")],
        ["order_type", "Order type", text(row, "order_type")],
        ["order_status", "Order status", text(row, "order_status")],
        ["last_updated_at", "Last updated (UTC)", timestamp(row, "last_updated_at")],
        ["sku_printed", "SKU (as printed)", text(row, "sku_printed")],
        ["fnsku", "FNSKU", text(row, "fnsku")],
        ["disposition", "Disposition", text(row, "disposition")],
        ["requested_quantity", "Requested quantity", quantity(row, "requested_quantity")],
        ["cancelled_quantity", "Cancelled quantity", quantity(row, "cancelled_quantity")],
        ["disposed_quantity", "Disposed quantity", quantity(row, "disposed_quantity")],
        ["shipped_quantity", "Shipped quantity", quantity(row, "shipped_quantity")],
        ["in_process_quantity", "In-process quantity", quantity(row, "in_process_quantity")],
        ["fee_amount", "Removal fee", money(row, "fee_amount")],
      ]);
  }
}

/**
 * What SelBox worked out from the printed row: the marketplace from the country code, the fee's
 * base and tax, and the inventory ledger months that find the SKU. Amazon prints none of them.
 */
export function rawRecordCalculations(dataset: RawReportKey, row: CanonicalRow): RawRecordField[] {
  if (dataset === "ad_invoices")
    return toFields([["tax_rate_percent", "Tax rate", `${quantity(row, "tax_rate_percent")}%`]]);
  const entries: Entry[] = [
    ["base_amount", "Base amount", money(row, "base_amount")],
    ["tax_amount", reportTaxLabel(row) ?? "Tax amount", money(row, "tax_amount")],
    [
      "ledger_months",
      "Inventory ledger months",
      span(month(row, "ledger_first_month"), month(row, "ledger_last_month")),
    ],
  ];
  // A removal order names no country, so it has no marketplace.
  if (dataset !== "removal_orders")
    entries.unshift(["marketplace_name", "Marketplace", text(row, "marketplace_name")]);
  return toFields(entries);
}

/** Where the row came from: seller account, region and SelBox's identifiers. */
export function rawRecordSource(dataset: RawReportKey, row: CanonicalRow): CanonicalRow[] {
  // Report rows are numbered in SelBox's order, not Amazon's line order.
  const identifiers: [string, string | null][] =
    dataset === "ad_invoices"
      ? []
      : [
          ["SelBox row", row.row_number],
          ["Record ID", row.id],
        ];
  const entries: [string, string | null][] = [
    ["Seller account", row.seller_namespace],
    ["Region", row.amazon_scope && regionLabel(row.amazon_scope)],
    ["Version ID", row.version_id],
    ...identifiers,
    ["Processed (UTC)", row.processed_at ? timestamp(row, "processed_at") : null],
  ];
  return entries.map(([field, value]) => ({ field, value }));
}
