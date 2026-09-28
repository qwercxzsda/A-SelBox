import type { AppAccount, CanonicalRow, DatasetKey, TableDatasetKey } from "./api/types.ts";
import { DATASET_CONFIG } from "./api/config.ts";

type CellKind = "code" | "company" | "date" | "money" | "percent" | "number" | "text" | "period";

export interface ColumnDefinition {
  align?: "right";
  key: string;
  kind: CellKind;
  label: string;
  sortable?: string;
}

interface WorkspacePresentation {
  description: string;
  label: string;
}

interface DatasetPresentation extends WorkspacePresentation {
  emptyMessage: string;
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
  return account.access_role === "operator" ? DATASET_ORDER : ["live", "fees", "payouts"];
}

export const DATASET_PRESENTATION = {
  live: {
    label: "Transactions",
    description:
      "Mature cutoff period: two calendar months (assumed). Mature dates (before the mature cutoff date) use Settlement authority with Data Kiosk detail. Recent dates (the mature cutoff date and later) use Data Kiosk only.",
    searchPlaceholder: "SKU, type, source, or marketplace",
    emptyMessage: "No transactions match this view.",
  },
  settlement: {
    label: "Settlements",
    description: "Sales, refunds, and charges from Amazon settlement reports.",
    searchPlaceholder: "SKU, type, or marketplace",
    emptyMessage: "No settlement transactions match this view.",
  },
  data_kiosk: {
    label: "Data Kiosk",
    description:
      "Daily sales, refunds, and charges reported by Amazon. Rows with a zero amount are hidden.",
    searchPlaceholder: "SKU, type, or marketplace",
    emptyMessage: "No Data Kiosk records match this view.",
  },
  fees: {
    label: "Current fees",
    description:
      "Fee rates by SKU and marketplace. Each rate applies from its start date up to, but excluding, its end date.",
  },
  payouts: {
    label: "Payout reports",
    description:
      "Monthly payouts preserve company amounts in the Settlement and Data Kiosk categories, plus service fees. The SelBox category and reconciliation difference stay with SelBox.",
    searchPlaceholder: "Report name or currency",
    emptyMessage: "No payout reports match this view.",
  },
  accounts: {
    label: "User access",
    description: "User roles and company access. Each company member belongs to one company.",
    searchPlaceholder: "Search unavailable for this view",
    emptyMessage: "No users match this view.",
  },
} satisfies Record<DatasetKey, WorkspacePresentation> &
  Record<TableDatasetKey, DatasetPresentation>;

export const PAGE_SIZES = [25, 50, 100] as const;

export const FINANCIAL_AMOUNTS = [
  ["reportedAmount", "Reported amount"],
  ["serviceFee", "Service fee"],
  ["companyAmount", "Company amount"],
] as const;

function column(key: string, label: string, kind: CellKind = "text"): ColumnDefinition {
  return {
    key,
    label,
    kind,
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
    column("category", "Category", "code"),
    column("component_type", "Type", "code"),
    column("quantity", "Quantity", "number"),
    column("source_amount", "Reported amount", "money"),
    column("fee_rate_percent", "Fee rate", "percent"),
    column("fee_amount", "Service fee", "money"),
    column("company_amount", "Company amount", "money"),
  ],
  settlement: [
    column("posted_date", "Date", "date"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("category", "Category", "code"),
    column("component_type", "Type", "code"),
    column("amount", "Reported amount", "money"),
    column("quantity", "Quantity", "number"),
    column("preprocess_version", "Processing version"),
  ],
  data_kiosk: [
    column("activity_date", "Date", "date"),
    column("sku", "SKU"),
    column("marketplace_name", "Marketplace"),
    column("category", "Category", "code"),
    column("component_type", "Type", "code"),
    column("amount", "Reported amount", "money"),
    column("quantity", "Quantity", "number"),
    column("preprocess_version", "Processing version"),
  ],
  fees: [
    column("marketplace_name", "Marketplace"),
    column("fee_rate_percent", "Fee rate", "percent"),
    column("valid_period", "Effective dates", "period"),
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

export function displayColumns(
  dataset: TableDatasetKey,
  isAdministrator: boolean,
): readonly ColumnDefinition[] {
  const sortColumns: readonly string[] = DATASET_CONFIG[dataset].sortColumns;
  return TABLE_COLUMNS[dataset]
    .filter(
      (column) =>
        isAdministrator ||
        (column.kind !== "company" &&
          column.key !== "preprocess_version" &&
          !(dataset === "settlement" && column.key === "category")),
    )
    .map((column) => ({
      ...column,
      sortable: sortColumns.includes(column.key) ? column.key : undefined,
    }));
}

export function rowId(row: CanonicalRow): string {
  return [row.source, row.id ?? row.source_row_id ?? row.user_id].filter(Boolean).join(":");
}

export function companyLabel(companyId: string | null, companies: Map<string, string>): string {
  return companyId ? (companies.get(companyId) ?? companyId) : "Unassigned";
}
