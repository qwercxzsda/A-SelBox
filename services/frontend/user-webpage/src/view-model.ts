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
  return DATASET_ORDER.filter(
    (key) => account.access_role === "operator" || (key !== "payouts" && key !== "accounts"),
  );
}

export const DATASET_PRESENTATION: Record<DatasetKey, DatasetPresentation> = {
  live: {
    label: "Live calculations",
    description:
      "Current company assignments and fees applied to source components. Comparison components are shown for context and do not contribute to company totals. Missing fees remain visible.",
    searchPlaceholder: "SKU, currency, component",
    emptyMessage: "No live components are available for your company.",
  },
  settlement: {
    label: "Settlement",
    description:
      "Preprocessed Settlement transactions. Company members see their current company results; operators can inspect retained versions.",
    searchPlaceholder: "SKU, currency, family",
    emptyMessage: "No Settlement transactions match this view.",
  },
  data_kiosk: {
    label: "Data Kiosk",
    description:
      "Daily marketplace components from Data Kiosk. Company members see current results for their company; operators can inspect retained versions.",
    searchPlaceholder: "SKU or currency",
    emptyMessage: "No Data Kiosk components match this view.",
  },
  fees: {
    label: "Current fees",
    description:
      "Marketplace fee periods in the currently selected SKU terms. Rates apply from the start date up to, but excluding, the end date.",
    searchPlaceholder: "Search unavailable for this view",
    emptyMessage: "No current fee periods are available.",
  },
  payouts: {
    label: "Payout reports",
    description:
      "Saved company payout reports retain the source and fee versions used when they were created.",
    searchPlaceholder: "Currency or calculation version",
    emptyMessage: "No payout reports have been created yet.",
  },
  accounts: {
    label: "People",
    description:
      "Application access for existing Auth accounts. Each company member belongs to one company.",
    searchPlaceholder: "Search unavailable for this view",
    emptyMessage: "No application accounts are available.",
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
    column("component_type", "Component", "code"),
    column("source_amount", "Source amount", "money"),
    column("fee_rate_percent", "Fee rate", "percent"),
    column("fee_amount", "Company fee", "money"),
    column("company_amount", "Company amount", "money"),
    column("resolution_status", "Fee status", "code"),
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
    column("preprocess_version", "Version"),
  ],
  data_kiosk: [
    column("activity_date", "Date", "date"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("category", "Category", "category"),
    column("component_type", "Component", "code"),
    column("amount", "Amount", "money"),
    column("quantity", "Quantity", "number"),
    column("preprocess_version", "Version"),
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
    column("source_amount", "Source amount", "money"),
    column("fee_amount", "Company fee", "money"),
    column("company_amount", "Company amount", "money"),
  ],
  accounts: [
    column("user_id", "Account ID"),
    column("access_role", "Role", "code"),
    column("company_id", "Company", "company"),
    column("created_at", "Added", "date"),
  ],
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request failure.";
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
