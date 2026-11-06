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
  "sku",
  "component_type",
  "currency",
  "source_amount",
  "quantity",
  "fee_base",
  "category",
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
  "category",
  "component_type",
  "accounting_subtype",
  "sku",
  "marketplace_name",
  "amount",
  "currency",
  "quantity",
  "fee_base",
  "posted_date",
  "posted_at",
  "transaction_type",
  "transaction_status",
  "account_type",
  "activity_eligible",
  "breakdown_path",
  "created_at",
] as const;

const DATA_KIOSK_COLUMNS = [
  "id",
  "version_id",
  "day_id",
  "preprocess_version",
  "batch_id",
  "is_current",
  "seller_namespace",
  "marketplace_name",
  "activity_date",
  "component_key",
  "sku",
  "category",
  "component_type",
  "amount",
  "currency",
  "quantity",
  "fee_base",
  "created_at",
] as const;

const PAYOUT_COLUMNS = [
  "id",
  "company_id",
  "marketplace_name",
  "currency",
  "start_date",
  "end_date",
  "dataset_key",
  "report_name",
  "change_reason",
  "calculation_version",
  "component_count",
  "finances_batch_count",
  "data_kiosk_observation_count",
  "terms_version_count",
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
// Other REST datasets search their published text fields, including payout month labels.
export const DATASET_CONFIG = {
  live: {
    label: "Transactions",
    selectColumns: LIVE_COLUMNS,
    searchColumns: ["sku", "component_type", "source", "marketplace_name"],
    sortColumns: ["activity_date", "source_amount"],
    defaultSort: { column: "activity_date", direction: "desc" },
    idColumns: ["source", "source_row_id"],
    dateColumn: "activity_date",
    filterColumns: ["sku", "marketplace_name", "source", "component_type"],
  },
  finances: {
    label: "Finances",
    selectColumns: FINANCES_COLUMNS,
    searchColumns: ["sku", "component_type", "marketplace_name"],
    sortColumns: ["posted_date", "amount"],
    defaultSort: { column: "posted_date", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "posted_date",
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  data_kiosk: {
    label: "Data Kiosk",
    selectColumns: DATA_KIOSK_COLUMNS,
    searchColumns: ["sku", "component_type", "marketplace_name"],
    sortColumns: ["activity_date", "amount"],
    defaultSort: { column: "activity_date", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "activity_date",
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  payouts: {
    label: "Payout reports",
    endpoint: "latest_company_payout_reports",
    selectColumns: PAYOUT_COLUMNS,
    searchColumns: ["month_label", "report_name", "marketplace_name", "currency"],
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
