import type { DatasetFilterField, DatasetSort, TableDatasetKey } from "./types.ts";
import {
  AD_INVOICE_COLUMNS,
  AGED_STORAGE_COLUMNS,
  REMOVAL_ORDER_COLUMNS,
  STORAGE_COLUMNS,
} from "./raw-columns.ts";

interface RowConfig {
  label: string;
  endpoint?: string;
  selectColumns: readonly string[];
  idColumns: readonly string[];
}

export interface DateFilterConfig {
  column: string;
  /** "month" selects one month start (dateFrom = dateTo = YYYY-MM-01); "range" selects days. */
  kind: "month" | "range";
  /** Names the filter field and its applied chip. */
  label: string;
}

export interface DatasetConfig extends RowConfig {
  searchColumns: readonly string[];
  sortColumns: readonly string[];
  defaultSort: DatasetSort;
  /** Orders rows that tie on the sort column, before the identifier tiebreak. */
  tiebreakOrder?: readonly string[];
  dateFilter: DateFilterConfig | null;
  filterColumns: readonly DatasetFilterField[];
}

const UTC_DATE_FILTER = { column: "activity_at", kind: "range", label: "Date (UTC)" } as const;

const LIVE_COLUMNS = [
  "source",
  "source_row_id",
  "source_version_id",
  "preprocess_version",
  "source_identity_id",
  "seller_namespace",
  "marketplace_name",
  "activity_date",
  "activity_at",
  "sku",
  "component_type",
  "currency",
  "base_amount",
  "tax_amount",
  "source_amount",
  "quantity",
  "fee_base",
  "outcome",
  "selbox_group",
  "sku_id",
  "terms_version_id",
  "company_id",
  "fee_period_id",
  "fee_rate_percent",
  "resolution_status",
  "fee_amount",
  "company_amount",
] as const;

const FINANCES_COLUMNS = [
  "id",
  "version_id",
  "preprocess_version",
  "batch_id",
  "is_current",
  "seller_namespace",
  "transaction_id",
  "native_transaction_id",
  "deferred_transaction_id",
  "release_transaction_id",
  "source_page_number",
  "source_record_number",
  "component_number",
  "route",
  "selbox_group",
  "component_type",
  "amount_part",
  "order_id",
  "reference_id",
  "reference_month",
  "ledger_start_month",
  "ledger_end_month",
  "fnsku",
  "asin",
  "sku",
  "marketplace_name",
  "amount",
  "currency",
  "quantity",
  "fee_base",
  "posted_date",
  "posted_at",
  "activity_at",
  "transaction_type",
  "transaction_status",
  "account_type",
  "activity_eligible",
  "breakdown_path",
  "created_at",
] as const;

const PAYOUT_COLUMNS = [
  "id",
  "company_id",
  "marketplace_name",
  "currency",
  "start_date",
  "end_date",
  "change_reason",
  "record_count",
  "source_version_count",
  "assignment_version_count",
  "source_amount",
  "fee_amount",
  "company_amount",
  "created_at",
] as const;

// Keep RPC CSV projections alphabetical to match PostgREST's serialized column order.
const ACCOUNT_COLUMNS = [
  "access_role",
  "company_id",
  "created_at",
  "email",
  "email_confirmed",
  "user_id",
] as const;

// Transaction searches resolve these visible fields to exact catalog values locally.
// Payout searches resolve browser-formatted month labels to factual dates.
export const DATASET_CONFIG = {
  live: {
    label: "Transactions",
    selectColumns: LIVE_COLUMNS,
    searchColumns: ["sku", "component_type", "source", "marketplace_name"],
    sortColumns: ["activity_at", "source_amount"],
    defaultSort: { column: "activity_at", direction: "desc" },
    idColumns: ["source", "source_row_id"],
    dateFilter: UTC_DATE_FILTER,
    filterColumns: ["sku", "marketplace_name", "source", "component_type"],
  },
  finances: {
    label: "Finances",
    selectColumns: FINANCES_COLUMNS,
    searchColumns: ["sku", "component_type", "marketplace_name"],
    sortColumns: ["activity_at", "amount"],
    defaultSort: { column: "activity_at", direction: "desc" },
    idColumns: ["id"],
    dateFilter: UTC_DATE_FILTER,
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  payouts: {
    label: "Payout reports",
    endpoint: "latest_company_payout_reports",
    selectColumns: PAYOUT_COLUMNS,
    searchColumns: ["marketplace_name", "currency"],
    sortColumns: ["start_date"],
    defaultSort: { column: "start_date", direction: "desc" },
    tiebreakOrder: ["company_id.asc", "marketplace_name.asc.nullslast", "currency.asc"],
    idColumns: ["id"],
    dateFilter: { column: "start_date", kind: "month", label: "Report month" },
    filterColumns: ["marketplace_name"],
  },
  accounts: {
    label: "User access",
    endpoint: "rpc/account_directory",
    selectColumns: ACCOUNT_COLUMNS,
    searchColumns: ["email"],
    sortColumns: ["email", "email_confirmed", "user_id", "access_role", "created_at"],
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["user_id"],
    dateFilter: null,
    filterColumns: [],
  },
  ad_invoices: {
    label: "Advertising invoice",
    endpoint: "current_ad_invoices",
    selectColumns: AD_INVOICE_COLUMNS,
    searchColumns: ["invoice_id"],
    sortColumns: ["invoice_date", "amount_due"],
    defaultSort: { column: "invoice_date", direction: "desc" },
    tiebreakOrder: ["invoice_id.asc"],
    idColumns: ["id"],
    dateFilter: { column: "invoice_date", kind: "range", label: "Invoice date" },
    filterColumns: ["marketplace_name"],
  },
  storage: {
    label: "Monthly storage report",
    endpoint: "current_storage_rows",
    selectColumns: STORAGE_COLUMNS,
    searchColumns: ["fnsku", "asin"],
    sortColumns: ["month_of_charge", "fee_amount"],
    defaultSort: { column: "month_of_charge", direction: "desc" },
    tiebreakOrder: ["marketplace_name.asc", "fnsku.asc", "fulfillment_center.asc.nullslast"],
    idColumns: ["id"],
    dateFilter: { column: "month_of_charge", kind: "month", label: "Month of charge" },
    filterColumns: ["marketplace_name"],
  },
  aged_storage: {
    label: "Aged storage report",
    endpoint: "current_aged_storage_rows",
    selectColumns: AGED_STORAGE_COLUMNS,
    searchColumns: ["fnsku", "asin", "sku_printed"],
    sortColumns: ["snapshot_month", "fee_amount"],
    defaultSort: { column: "snapshot_month", direction: "desc" },
    tiebreakOrder: ["marketplace_name.asc", "fnsku.asc"],
    idColumns: ["id"],
    dateFilter: { column: "snapshot_month", kind: "month", label: "Snapshot month" },
    filterColumns: ["marketplace_name"],
  },
  // Amazon gives no marketplace for a removal order, so it has no marketplace filter.
  removal_orders: {
    label: "Removal order report",
    endpoint: "current_removal_order_rows",
    selectColumns: REMOVAL_ORDER_COLUMNS,
    searchColumns: ["removal_order_id", "fnsku", "sku_printed"],
    sortColumns: ["request_date", "fee_amount"],
    defaultSort: { column: "request_date", direction: "desc" },
    tiebreakOrder: ["removal_order_id.asc", "fnsku.asc", "disposition.asc.nullslast"],
    idColumns: ["id"],
    dateFilter: { column: "request_date", kind: "range", label: "Request date (UTC)" },
    filterColumns: [],
  },
} as const satisfies Record<TableDatasetKey, DatasetConfig>;

export function isTableDataset(dataset: string): dataset is TableDatasetKey {
  return Object.hasOwn(DATASET_CONFIG, dataset);
}
