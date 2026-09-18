import type { DatasetFilterField, DatasetKey, DatasetSort } from "./types.ts";

export interface DatasetConfig {
  label: string;
  endpoint: string;
  selectColumns: readonly string[];
  searchColumns: readonly string[];
  sortColumns: readonly string[];
  defaultSort: DatasetSort;
  idColumns: readonly string[];
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
  "authoritative",
  "seller_sku_id",
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
  "seller_sku_id",
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
  "settlement_version_count",
  "data_kiosk_version_count",
  "terms_version_count",
  "source_amount",
  "fee_amount",
  "company_amount",
  "created_at",
] as const;

const ACCOUNT_COLUMNS = ["user_id", "access_role", "company_id", "created_at"] as const;

// Search only actual text columns. PostgREST cannot apply ilike to our enums
// or private domains, even when their CSV representation looks like text.
export const DATASET_CONFIG = {
  live: {
    label: "Transactions",
    endpoint: "live_company_components",
    selectColumns: LIVE_COLUMNS,
    searchColumns: [
      "source",
      "seller_namespace",
      "sku",
      "component_type",
      "currency",
      "resolution_status",
      "preprocess_version",
    ],
    sortColumns: LIVE_COLUMNS,
    defaultSort: { column: "activity_date", direction: "desc" },
    idColumns: ["source", "source_row_id"],
    dateColumn: "activity_date",
    filterColumns: ["sku", "marketplace_name", "source", "component_type"],
  },
  settlement: {
    label: "Settlements",
    endpoint: "settlement_preprocess_entries",
    selectColumns: SETTLEMENT_COLUMNS,
    searchColumns: ["sku", "currency", "family", "accounting_subtype"],
    sortColumns: SETTLEMENT_COLUMNS,
    defaultSort: { column: "posted_date", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "posted_date",
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  data_kiosk: {
    label: "Data Kiosk",
    endpoint: "data_kiosk_preprocess_entries",
    selectColumns: DATA_KIOSK_COLUMNS,
    searchColumns: ["sku", "currency", "source_document_id"],
    sortColumns: DATA_KIOSK_COLUMNS,
    defaultSort: { column: "activity_date", direction: "desc" },
    idColumns: ["id"],
    dateColumn: "activity_date",
    filterColumns: ["sku", "marketplace_name", "component_type"],
  },
  fees: {
    label: "Current fees",
    endpoint: "current_sku_fee_periods",
    selectColumns: FEE_COLUMNS,
    searchColumns: [],
    sortColumns: FEE_COLUMNS,
    defaultSort: { column: "fee_rate_percent", direction: "asc" },
    idColumns: ["fee_period_id"],
    dateColumn: null,
    filterColumns: ["marketplace_name"],
  },
  payouts: {
    label: "Payout reports",
    endpoint: "company_payout_reports",
    selectColumns: PAYOUT_COLUMNS,
    searchColumns: ["currency", "dataset_key", "calculation_version"],
    sortColumns: PAYOUT_COLUMNS,
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["id"],
    dateColumn: null,
    filterColumns: [],
  },
  accounts: {
    label: "User access",
    endpoint: "app_accounts",
    selectColumns: ACCOUNT_COLUMNS,
    searchColumns: [],
    sortColumns: ACCOUNT_COLUMNS,
    defaultSort: { column: "created_at", direction: "desc" },
    idColumns: ["user_id"],
    dateColumn: null,
    filterColumns: [],
  },
} as const satisfies Record<DatasetKey, DatasetConfig>;
