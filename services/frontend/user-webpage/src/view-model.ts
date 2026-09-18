import type { AppAccount, CanonicalRow, DatasetKey } from "./api/types.ts";

type CellKind =
  | "category"
  | "code"
  | "company"
  | "date"
  | "money"
  | "percent"
  | "number"
  | "text"
  | "sku"
  | "period";

export interface ColumnDefinition {
  align?: "right";
  key: string;
  kind: CellKind;
  label: string;
  sortable?: string;
}

export interface DatasetPresentation {
  description: string;
  emptyMessage: string;
  label: string;
  searchPlaceholder: string;
}

export const DATASET_ORDER: readonly DatasetKey[] = [
  "live",
  "settlement",
  "data_kiosk",
  "fees",
  "payouts",
  "accounts",
];

export function visibleDatasets(account: AppAccount): readonly DatasetKey[] {
  return account.access_role === "operator" ? DATASET_ORDER : ["live", "fees"];
}

export const DATASET_PRESENTATION: Record<DatasetKey, DatasetPresentation> = {
  live: {
    label: "Transactions",
    description:
      "Amounts reported by Amazon, service fees, and the resulting company amounts. Comparison-only rows are excluded from totals. Missing fee rates remain visible.",
    searchPlaceholder: "SKU, currency, or type",
    emptyMessage: "No transactions match this view.",
  },
  settlement: {
    label: "Settlements",
    description: "Sales, refunds, and charges from Amazon settlement reports.",
    searchPlaceholder: "SKU or currency",
    emptyMessage: "No settlement transactions match this view.",
  },
  data_kiosk: {
    label: "Data Kiosk",
    description:
      "Daily sales, refunds, and charges reported by Amazon. Rows with a zero amount are hidden.",
    searchPlaceholder: "SKU or currency",
    emptyMessage: "No Data Kiosk records match this view.",
  },
  fees: {
    label: "Current fees",
    description:
      "Fee rates by SKU and marketplace. Each rate applies from its start date up to, but excluding, its end date.",
    searchPlaceholder: "Search unavailable for this view",
    emptyMessage: "No fee rates match this view.",
  },
  payouts: {
    label: "Payout reports",
    description:
      "Saved payout calculations use the transactions and fee rates recorded when each report was created.",
    searchPlaceholder: "Currency or calculation version",
    emptyMessage: "No payout reports match this view.",
  },
  accounts: {
    label: "User access",
    description: "User roles and company access. Each company member belongs to one company.",
    searchPlaceholder: "Search unavailable for this view",
    emptyMessage: "No users match this view.",
  },
};

export const PAGE_SIZES = [25, 50, 100] as const;

function column(key: string, label: string, kind: CellKind = "text"): ColumnDefinition {
  return {
    key,
    label,
    kind,
    sortable: kind === "company" || kind === "sku" ? undefined : key,
    align: kind === "money" || kind === "percent" || kind === "number" ? "right" : undefined,
  };
}

export const TABLE_COLUMNS: Record<DatasetKey, readonly ColumnDefinition[]> = {
  live: [
    column("activity_date", "Date", "date"),
    column("company_id", "Company", "company"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("source", "Source", "code"),
    column("component_type", "Type", "code"),
    column("source_amount", "Reported amount", "money"),
    column("fee_rate_percent", "Fee rate", "percent"),
    column("fee_amount", "Service fee", "money"),
    column("company_amount", "Company amount", "money"),
    column("authoritative", "Included in totals"),
  ],
  settlement: [
    column("posted_date", "Date", "date"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("category", "Category", "category"),
    column("transaction_type", "Transaction"),
    column("amount_description", "Description"),
    column("amount", "Amount", "money"),
    column("quantity", "Quantity", "number"),
    column("preprocess_version", "Processing version"),
  ],
  data_kiosk: [
    column("activity_date", "Date", "date"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("category", "Category", "category"),
    column("component_type", "Type", "code"),
    column("amount", "Amount", "money"),
    column("quantity", "Quantity", "number"),
    column("preprocess_version", "Processing version"),
  ],
  fees: [
    column("seller_sku_id", "SKU", "sku"),
    column("company_id", "Company", "company"),
    column("marketplace_name", "Marketplace"),
    column("valid_period", "Effective dates", "period"),
    column("fee_rate_percent", "Fee rate", "percent"),
  ],
  payouts: [
    column("created_at", "Created", "date"),
    column("company_id", "Company", "company"),
    column("start_date", "From", "date"),
    column("end_date", "Through", "date"),
    column("source_amount", "Reported amount", "money"),
    column("fee_amount", "Service fee", "money"),
    column("company_amount", "Company amount", "money"),
  ],
  accounts: [
    column("user_id", "User ID"),
    column("access_role", "Role", "code"),
    column("company_id", "Company", "company"),
    column("created_at", "Added", "date"),
  ],
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

const TRANSACTION_SORT_COLUMNS = new Set([
  "activity_date",
  "posted_date",
  "source_amount",
  "amount",
  "fee_rate_percent",
  "fee_amount",
  "company_amount",
]);

export function displayColumns(
  dataset: DatasetKey,
  isAdministrator: boolean,
): readonly ColumnDefinition[] {
  const transactionView =
    dataset === "live" || dataset === "settlement" || dataset === "data_kiosk";
  return TABLE_COLUMNS[dataset]
    .filter(
      (column) =>
        isAdministrator ||
        (column.kind !== "company" &&
          column.key !== "preprocess_version" &&
          !(dataset === "settlement" && column.key === "category")),
    )
    .map((column) =>
      transactionView && !TRANSACTION_SORT_COLUMNS.has(column.key)
        ? { ...column, sortable: undefined }
        : column,
    );
}

export function rowText(row: CanonicalRow, key: string): string | null {
  return row[key] ?? null;
}

export function rowId(row: CanonicalRow): string {
  return [row.source, row.id ?? row.source_row_id ?? row.fee_period_id ?? row.user_id]
    .filter(Boolean)
    .join(":");
}

export function formatDate(value: string | null): string {
  return value === null || value.length === 0 ? "—" : value;
}

export function companyLabel(companyId: string | null, companies: Map<string, string>): string {
  return companyId ? (companies.get(companyId) ?? companyId) : "Unassigned";
}
