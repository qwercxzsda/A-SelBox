export type DatasetKey = "live" | "settlement" | "data_kiosk" | "fees" | "payouts" | "accounts";
export type SortDirection = "asc" | "desc";
export type DecimalString = string;

export interface SessionUser {
  id: string;
  email?: string;
}

export interface Session {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  refresh_token: string;
  user: SessionUser;
}

export interface Company {
  id: string;
  name: string;
}

export interface AppAccount {
  user_id: string;
  access_role: "operator" | "company_member";
  company_id: string | null;
}

export type RevisionSource = "settlement" | "data_kiosk" | "fees";
export type WorkspaceRevisions = Partial<Record<RevisionSource, string>>;

export interface WorkspaceRevisionSnapshot {
  account: AppAccount;
  revisions: WorkspaceRevisions;
}

export interface FetchWorkspaceRevisionsOptions {
  accessToken: string;
  userId: string;
  sources: readonly RevisionSource[];
  signal?: AbortSignal;
}

export interface SkuAssignment {
  id: string;
  seller_namespace: string;
  sku: string;
  company_id: string;
  terms_version_id: string;
}

// CSV and the transaction RPC keep numerics exact and SQL NULL distinct from empty text.
export type CanonicalRow = Record<string, string | null>;

export interface PageResult {
  rows: CanonicalRow[];
  totalCount: number | null;
}

export interface DatasetSort {
  column: string;
  direction: SortDirection;
}

export type DatasetFilterField = "sku" | "marketplace_name" | "source" | "component_type";

export interface DatasetFilters {
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
  skus: string[];
  marketplaces: string[];
  sources: string[];
  types: string[];
  feeApplicability: string[];
}

export interface FetchDatasetPageOptions {
  accessToken: string;
  signal?: AbortSignal;
  dataset: DatasetKey;
  pageIndex: number;
  pageSize: number;
  search: string;
  sort: DatasetSort;
  filters?: DatasetFilters;
  includeCount?: boolean;
}

export type FetchDatasetCountOptions = Pick<
  FetchDatasetPageOptions,
  "accessToken" | "signal" | "dataset" | "search" | "filters"
>;

export interface CurrencyTotal {
  currency: string;
  reportedAmount: DecimalString | null;
  serviceFee: DecimalString | null;
  companyAmount: DecimalString | null;
  rowCount: number;
  missingFeeCount: number;
}

export interface TransactionSummaryFilters {
  companyIds?: string[];
  skus?: string[];
  marketplaces?: string[];
}

export interface FetchLatestTransactionDateOptions extends TransactionSummaryFilters {
  accessToken: string;
  signal?: AbortSignal;
}

export interface FetchTransactionPeriodTotalsOptions extends FetchLatestTransactionDateOptions {
  dateFrom: string;
  dateTo: string;
}

export interface FetchTransactionTypeTotalsOptions extends FetchTransactionPeriodTotalsOptions {
  currency: string;
}

export interface TransactionTypeTotal extends CurrencyTotal {
  type: string;
}
