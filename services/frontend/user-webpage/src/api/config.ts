import type { DatasetFilterField, DatasetSort, TableDatasetKey } from "./types.ts";

interface RowConfig {
  label: string;
  endpoint?: string;
  selectColumns: readonly string[];
  idColumns: readonly string[];
}

export interface DatasetConfig extends RowConfig {
  searchColumns: readonly string[];
  sortColumns: readonly string[];
  defaultSort: DatasetSort;
  dateColumn: string | null;
  filterColumns: readonly DatasetFilterField[];
}

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
    dateColumn: "activity_at",
    filterColumns: ["sku", "marketplace_name", "source", "component_type"],
  },
  finances: {
    label: "Finances",
    selectColumns: FINANCES_COLUMNS,
    searchColumns: ["sku", "component_type", "marketplace_name"],
    sortColumns: ["activity_at", "amount"],
    defaultSort: { column: "activity_at", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "activity_at",
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  payouts: {
    label: "Payout reports",
    endpoint: "latest_company_payout_reports",
    selectColumns: PAYOUT_COLUMNS,
    searchColumns: ["marketplace_name", "currency"],
    sortColumns: ["start_date"],
    defaultSort: { column: "start_date", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "start_date",
    filterColumns: ["marketplace_name"],
  },
  accounts: {
    label: "User access",
    endpoint: "rpc/account_directory",
    selectColumns: ACCOUNT_COLUMNS,
    searchColumns: ["email"],
    sortColumns: ["email", "user_id", "access_role", "created_at"],
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["user_id"],
    dateColumn: null,
    filterColumns: [],
  },
} as const satisfies Record<TableDatasetKey, DatasetConfig>;

export function isTableDataset(dataset: string): dataset is TableDatasetKey {
  return Object.hasOwn(DATASET_CONFIG, dataset);
}
