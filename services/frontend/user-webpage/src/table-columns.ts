import type { CanonicalRow, TableDatasetKey } from "./api/types.ts";
import { DATASET_CONFIG } from "./api/config.ts";
import { removalQuantityNote, reportTaxNote } from "./raw-report-rows.ts";

/**
 * "exact-money" never rounds; "period" runs to endKey; "region" and "invoice-status" are Amazon
 * codes with fixed labels. "name" identifies the row, as on every list; "yes-no" is a PostgREST
 * CSV boolean.
 */
type CellKind =
  | "code"
  | "company"
  | "date"
  | "name"
  | "yes-no"
  | "month"
  | "money"
  | "exact-money"
  | "percent"
  | "number"
  | "region"
  | "invoice-status"
  | "period"
  | "text";

export interface ColumnDefinition {
  align?: "right";
  key: string;
  kind: CellKind;
  label: string;
  sortable?: string;
  secondary?: Pick<ColumnDefinition, "key" | "kind" | "label">;
  /** The last day of a "period" column. */
  endKey?: string;
  /** A line beneath the value worked out from the whole row, when `secondary` cannot say it. */
  note?: (row: CanonicalRow) => string | null;
}

export function isAmountKind(kind: CellKind): boolean {
  return kind === "money" || kind === "exact-money";
}

function column(key: string, label: string, kind: CellKind = "text"): ColumnDefinition {
  return {
    key,
    label,
    kind,
    align: isAmountKind(kind) || kind === "percent" || kind === "number" ? "right" : undefined,
  };
}

const earlierVersionNote = (row: CanonicalRow) =>
  row.is_current === "false" ? "Earlier version" : null;

/** A report fee with SelBox's tax beneath, saying whether the fee includes it. */
function reportFeeColumn(label: string): ColumnDefinition {
  return { ...column("fee_amount", label, "exact-money"), note: reportTaxNote };
}

export const TABLE_COLUMNS: Record<TableDatasetKey, readonly ColumnDefinition[]> = {
  live: [
    column("activity_at", "Date (UTC)", "date"),
    column("company_id", "Company", "company"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("source", "Source", "code"),
    column("outcome", "Outcome", "code"),
    column("component_type", "Type", "code"),
    {
      ...column("source_amount", "Reported amount", "money"),
      secondary: column("quantity", "Quantity", "number"),
    },
    {
      ...column("fee_amount", "Service fee", "money"),
      secondary: column("fee_rate_percent", "Fee rate", "percent"),
    },
    column("company_amount", "Company amount", "money"),
  ],
  finances: [
    { ...column("activity_at", "Date (UTC)", "date"), note: earlierVersionNote },
    column("activity_eligible", "Activity eligibility", "code"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("route", "Route", "code"),
    column("component_type", "Type", "code"),
    column("amount", "Reported amount", "exact-money"),
    column("quantity", "Quantity", "number"),
  ],
  payouts: [
    column("start_date", "Month", "month"),
    column("company_id", "Company", "company"),
    column("marketplace_name", "Marketplace"),
    column("created_at", "Updated (UTC)", "date"),
    column("source_amount", "Reported amount", "money"),
    column("fee_amount", "Service fee", "money"),
    column("company_amount", "Company amount", "money"),
  ],
  accounts: [
    column("email", "Email", "name"),
    column("email_confirmed", "Email confirmed", "yes-no"),
    column("access_role", "Role", "code"),
    column("company_id", "Company", "company"),
    column("created_at", "Joined (UTC)", "date"),
  ],
  ad_invoices: [
    column("invoice_date", "Invoice date", "date"),
    column("invoice_id", "Invoice ID"),
    column("marketplace_name", "Marketplace"),
    { ...column("from_date", "Billing period", "period"), endKey: "to_date" },
    column("invoice_status", "Status", "invoice-status"),
    column("line_count", "Lines", "number"),
    {
      ...column("amount_due", "Amount due", "exact-money"),
      secondary: column("tax_amount_due", "Tax due", "exact-money"),
    },
  ],
  storage: [
    column("month_of_charge", "Month of charge", "month"),
    column("marketplace_name", "Marketplace"),
    column("fnsku", "FNSKU"),
    column("asin", "ASIN"),
    column("fulfillment_center", "Fulfillment center"),
    column("average_quantity_on_hand", "Average quantity on hand", "number"),
    reportFeeColumn("Estimated monthly storage fee"),
  ],
  aged_storage: [
    column("snapshot_month", "Snapshot month", "month"),
    column("marketplace_name", "Marketplace"),
    column("sku_printed", "SKU (as printed)"),
    column("fnsku", "FNSKU"),
    column("asin", "ASIN"),
    column("age_tier", "Age tier"),
    column("quantity_charged", "Quantity charged", "number"),
    reportFeeColumn("Amount charged"),
  ],
  // Amazon gives no marketplace for a removal order: the seller account's region stands in.
  // One row is an order × FNSKU × disposition.
  removal_orders: [
    column("request_date", "Request date (UTC)", "date"),
    column("removal_order_id", "Order ID"),
    column("amazon_scope", "Region", "region"),
    column("order_type", "Order type"),
    column("order_status", "Order status"),
    column("sku_printed", "SKU (as printed)"),
    column("fnsku", "FNSKU"),
    column("disposition", "Disposition"),
    { ...column("requested_quantity", "Requested quantity", "number"), note: removalQuantityNote },
    reportFeeColumn("Removal fee"),
  ],
};

export function displayColumns(
  dataset: TableDatasetKey,
  isAdministrator: boolean,
): readonly ColumnDefinition[] {
  const sortColumns: readonly string[] = DATASET_CONFIG[dataset].sortColumns;
  return TABLE_COLUMNS[dataset]
    .filter((column) => isAdministrator || column.kind !== "company")
    .map((column) => ({
      ...column,
      sortable: sortColumns.includes(column.key) ? column.key : undefined,
    }));
}
