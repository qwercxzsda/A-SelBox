import type { AppAccount, CanonicalRow, DatasetKey, TableDatasetKey } from "./api/types.ts";

interface WorkspacePresentation {
  description: string;
  label: string;
}

interface DatasetPresentation extends WorkspacePresentation {
  /** What one row is, in the plural, for counts: "1–25 of 120 invoices". */
  items: string;
  /** What a failed read names: "Could not load <loadSubject>". */
  loadSubject: string;
  emptyMessage: string;
  /** The empty-state title when search or filters match nothing. */
  noMatchMessage: string;
  searchPlaceholder: string;
}

export const DATASET_ORDER: readonly DatasetKey[] = ["live", "fees", "payouts", "accounts"];

export function visibleDatasets(account: AppAccount): readonly DatasetKey[] {
  if (account.access_role === "unassigned") return [];
  return account.access_role === "administrator" ? DATASET_ORDER : ["live", "fees", "payouts"];
}

export const DATASET_PRESENTATION = {
  live: {
    label: "Transactions",
    description:
      "Dates, ordering, filters and totals use UTC. Reference costs use the posting date of the first matching Finances charge.",
    searchPlaceholder: "SKU, type, source, or marketplace",
    items: "transactions",
    loadSubject: "transactions",
    emptyMessage: "No transactions yet",
    noMatchMessage: "No matching transactions",
  },
  finances: {
    label: "Finances",
    description:
      "Source records from immutable transaction versions. Activity eligibility applies within each version; Transactions uses the current version.",
    searchPlaceholder: "SKU, type, or marketplace",
    // One amount Amazon breaks a Finances transaction into.
    items: "breakdowns",
    loadSubject: "Finances transactions",
    emptyMessage: "No Finances transactions yet",
    noMatchMessage: "No matching Finances transactions",
  },
  fees: {
    label: "Current fees",
    description: "Company assignments and marketplace fee rates for each exact SKU.",
  },
  payouts: {
    label: "Payout reports",
    description:
      "Monthly payouts include the company’s attributed Finances activity and service fees. Open a saved version to inspect its records.",
    searchPlaceholder: "Month, marketplace, or currency",
    items: "latest reports",
    loadSubject: "payout reports",
    emptyMessage: "No payout reports yet",
    noMatchMessage: "No matching payout reports",
  },
  accounts: {
    label: "User access",
    description:
      "Select a user to assign, change, or revoke company membership. Administrator access is managed by the database manager.",
    searchPlaceholder: "Email",
    items: "users",
    loadSubject: "users",
    emptyMessage: "No users yet",
    noMatchMessage: "No matching users",
  },
  ad_invoices: {
    label: "Advertising invoice",
    description: "Amazon Ads invoices, one row per invoice. Open one to see its lines.",
    searchPlaceholder: "Invoice ID",
    items: "invoices",
    loadSubject: "advertising invoices",
    emptyMessage: "No advertising invoices yet",
    noMatchMessage: "No matching advertising invoices",
  },
  storage: {
    label: "Monthly storage report",
    description: "Amazon's estimated monthly storage fee per FNSKU and fulfillment center.",
    searchPlaceholder: "FNSKU or ASIN",
    // One FNSKU at one fulfillment center for one month.
    items: "storage fees",
    loadSubject: "storage fees",
    emptyMessage: "No storage fees yet",
    noMatchMessage: "No matching storage fees",
  },
  aged_storage: {
    label: "Aged storage report",
    description: "Amazon's surcharge for stock held past an age limit, per monthly snapshot.",
    searchPlaceholder: "FNSKU, ASIN, or SKU",
    // One FNSKU in one monthly snapshot.
    items: "aged storage fees",
    loadSubject: "aged storage fees",
    emptyMessage: "No aged storage fees yet",
    noMatchMessage: "No matching aged storage fees",
  },
  removal_orders: {
    label: "Removal order report",
    description: "Requests to return or dispose of stock. The removal fee includes tax.",
    searchPlaceholder: "Order ID, FNSKU, or SKU",
    // One FNSKU and disposition of an order.
    items: "removal order lines",
    loadSubject: "removal orders",
    emptyMessage: "No removal orders yet",
    noMatchMessage: "No matching removal orders",
  },
} satisfies Record<DatasetKey, WorkspacePresentation> &
  Record<TableDatasetKey, DatasetPresentation>;

export const PAGE_SIZES = [25, 50, 100] as const;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

export function rowId(row: CanonicalRow): string {
  return [row.source, row.id ?? row.source_row_id ?? row.user_id].filter(Boolean).join(":");
}

export function companyLabel(companyId: string | null, companies: Map<string, string>): string {
  return companyId ? (companies.get(companyId) ?? companyId) : "Unassigned";
}
