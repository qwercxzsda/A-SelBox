import type { DatasetFilterField, DatasetKey, DatasetSort, TableDatasetKey } from "./types.ts";

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

const SETTLEMENT_COLUMNS = [
  "id",
  "version_id",
  "settlement_id",
  "preprocess_version",
  "seller_namespace",
  "source_line_number",
  "category",
  "family",
  "component_type",
  "accounting_subtype",
  "sku",
  "marketplace_name",
  "amount",
  "currency",
  "quantity",
  "posted_date",
  "posted_at",
  "transaction_type",
  "amount_type",
  "amount_description",
  "created_at",
] as const;

const DATA_KIOSK_COLUMNS = [
  "id",
  "version_id",
  "day_id",
  "preprocess_version",
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
  "source_document_id",
  "source_line_number",
  "created_at",
] as const;

const FEE_COLUMNS = [
  "sku_id",
  "company_id",
  "terms_version_id",
  "marketplace_name",
  "fee_period_id",
  "valid_period",
  "fee_rate_percent",
] as const;

const PAYOUT_COLUMNS = [
  "id",
  "company_id",
  "seller_namespace",
  "currency",
  "start_date",
  "end_date",
  "preprocess_version",
  "dataset_key",
  "report_name",
  "change_reason",
  "calculation_version",
  "component_count",
  "reconciliation_count",
  "settlement_version_count",
  "data_kiosk_version_count",
  "terms_version_count",
  "source_amount",
  "fee_amount",
  "company_amount",
  "created_at",
] as const;

const ACCOUNT_COLUMNS = ["user_id", "access_role", "company_id", "created_at"] as const;

// Transaction searches resolve these visible fields to exact catalog values locally.
// Other REST datasets search only native text fields.
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
  settlement: {
    label: "Settlements",
    selectColumns: SETTLEMENT_COLUMNS,
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
  fees: {
    label: "Current fees",
    endpoint: "current_sku_fee_periods",
    selectColumns: FEE_COLUMNS,
    idColumns: ["fee_period_id"],
  },
  payouts: {
    label: "Payout reports",
    endpoint: "company_payout_reports",
    selectColumns: PAYOUT_COLUMNS,
    searchColumns: ["report_name", "currency"],
    sortColumns: ["created_at", "start_date", "end_date", "company_amount"],
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "start_date",
    filterColumns: [],
  },
  accounts: {
    label: "User access",
    endpoint: "app_accounts",
    selectColumns: ACCOUNT_COLUMNS,
    searchColumns: [],
    sortColumns: ["user_id", "access_role", "created_at"],
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["user_id"],
    dateColumn: null,
    filterColumns: [],
  },
} as const satisfies Record<DatasetKey, RowConfig> & Record<TableDatasetKey, DatasetConfig>;

export function isTableDataset(dataset: string): dataset is TableDatasetKey {
  return dataset !== "fees" && Object.hasOwn(DATASET_CONFIG, dataset);
}
