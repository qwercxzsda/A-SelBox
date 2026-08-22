import type { CanonicalRow, DatasetKey } from "./api";

type CellKind = "category" | "code" | "company" | "date" | "money" | "text";

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

export const DATASET_ORDER: readonly DatasetKey[] = ["sku", "account", "excluded"];

export const DATASET_PRESENTATION: Record<DatasetKey, DatasetPresentation> = {
  sku: {
    description:
      "One row is one published company/SKU allocation target. Settlement, elaborated, and Difference amounts remain separate and exact.",
    emptyMessage: "No published SKU economics targets are visible to this account.",
    label: "SKU economics",
    searchPlaceholder: "SKU, order, marketplace, category",
  },
  account: {
    description:
      "Company-only and unassigned non-excluded targets. Unassigned review rows are visible only to administrators.",
    emptyMessage: "No account-level or unassigned targets are visible to this account.",
    label: "Account-level",
    searchPlaceholder: "SKU, order, marketplace, category, reason",
  },
  excluded: {
    description:
      "Payout, transfer, reserve, and balance movements retained for treasury reconciliation and excluded from economics P&L.",
    emptyMessage:
      "No excluded movements are visible. This read model is restricted to administrators.",
    label: "Excluded movements",
    searchPlaceholder: "Category, adjustment, shipment, reason",
  },
};

export const PAGE_SIZES = [25, 50, 100] as const;

export const TABLE_COLUMNS: Record<DatasetKey, readonly ColumnDefinition[]> = {
  sku: [
    { key: "posted_date", kind: "date", label: "Posted", sortable: "posted_date" },
    { key: "company_id", kind: "company", label: "Company" },
    { key: "amz_sku", kind: "text", label: "SKU", sortable: "amz_sku" },
    {
      key: "marketplace_name",
      kind: "text",
      label: "Marketplace",
      sortable: "marketplace_name",
    },
    { key: "order_id", kind: "text", label: "Order", sortable: "order_id" },
    {
      key: "settlement_category",
      kind: "category",
      label: "Category",
      sortable: "settlement_category",
    },
    {
      key: "elaborated_amount",
      kind: "money",
      label: "Elaborated",
      sortable: "elaborated_amount",
      align: "right",
    },
    {
      key: "difference_amount",
      kind: "money",
      label: "Difference",
      sortable: "difference_amount",
      align: "right",
    },
    {
      key: "settlement_amount",
      kind: "money",
      label: "Settlement",
      sortable: "settlement_amount",
      align: "right",
    },
    {
      key: "selbox_fee",
      kind: "money",
      label: "SelBox fee",
      sortable: "selbox_fee",
      align: "right",
    },
    {
      key: "company_payable",
      kind: "money",
      label: "Company payable",
      sortable: "company_payable",
      align: "right",
    },
  ],
  account: [
    { key: "posted_date", kind: "date", label: "Posted", sortable: "posted_date" },
    { key: "company_id", kind: "company", label: "Company" },
    { key: "amz_sku", kind: "text", label: "SKU", sortable: "amz_sku" },
    {
      key: "marketplace_name",
      kind: "text",
      label: "Marketplace",
      sortable: "marketplace_name",
    },
    { key: "order_id", kind: "text", label: "Order", sortable: "order_id" },
    {
      key: "category_code",
      kind: "category",
      label: "Category",
      sortable: "category_code",
    },
    {
      key: "handling_method",
      kind: "code",
      label: "Handling",
      sortable: "handling_method",
    },
    {
      key: "difference_amount",
      kind: "money",
      label: "Difference",
      sortable: "difference_amount",
      align: "right",
    },
    {
      key: "settlement_amount",
      kind: "money",
      label: "Settlement",
      sortable: "settlement_amount",
      align: "right",
    },
    {
      key: "company_payable",
      kind: "money",
      label: "Company payable",
      sortable: "company_payable",
      align: "right",
    },
  ],
  excluded: [
    { key: "posted_date", kind: "date", label: "Posted", sortable: "posted_date" },
    {
      key: "category_code",
      kind: "category",
      label: "Category",
      sortable: "category_code",
    },
    {
      key: "handling_method",
      kind: "code",
      label: "Handling",
      sortable: "handling_method",
    },
    {
      key: "adjustment_id",
      kind: "text",
      label: "Adjustment",
      sortable: "adjustment_id",
    },
    {
      key: "shipment_id",
      kind: "text",
      label: "Shipment",
      sortable: "shipment_id",
    },
    { key: "unassigned_reason", kind: "code", label: "Reason" },
    {
      key: "difference_amount",
      kind: "money",
      label: "Difference",
      sortable: "difference_amount",
      align: "right",
    },
    {
      key: "settlement_amount",
      kind: "money",
      label: "Settlement",
      sortable: "settlement_amount",
      align: "right",
    },
  ],
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

function rowRecord(row: CanonicalRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>;
}

export function rowText(row: CanonicalRow, key: string): string | null {
  const value = rowRecord(row)[key];
  return typeof value === "string" ? value : null;
}

export function rowId(row: CanonicalRow): string {
  return rowText(row, "id") ?? "";
}

export function formatDate(value: string | null): string {
  return value === null || value.length === 0 ? "—" : value;
}

export function companyLabel(companyId: string | null, companies: Map<string, string>): string {
  return companyId ? (companies.get(companyId) ?? companyId) : "Unassigned";
}
