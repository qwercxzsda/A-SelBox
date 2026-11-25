/** Amazon reports SelBox keeps, read as their current versions. */
export type RawReportKey = "ad_invoices" | "storage" | "aged_storage" | "removal_orders";
/** The Raw data sub-tabs: Finances (every version) and the four reports. */
export type RawDatasetKey = "finances" | RawReportKey;
export type TableDatasetKey = "live" | "payouts" | "accounts" | RawDatasetKey;
/** Top-level workspace tabs backed by one dataset. */
export type DatasetKey = Exclude<TableDatasetKey, RawDatasetKey> | "fees";
type SortDirection = "asc" | "desc";
type DecimalString = string;

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
  created_at: string | null;
}

export interface AppAccount {
  user_id: string;
  access_role: "administrator" | "member" | "unassigned";
  company_id: string | null;
}

export type RevisionSource = "references" | "finances" | "fees" | "inventory" | "payouts";
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

export interface TransactionSearchValues {
  skus: string[];
  marketplaces: string[];
  types: string[];
  sources: string[];
}

export interface FetchDatasetPageOptions {
  accessToken: string;
  signal?: AbortSignal;
  dataset: TableDatasetKey;
  pageIndex: number;
  pageSize: number;
  search: string;
  searchValues?: TransactionSearchValues | null;
  sort: DatasetSort;
  filters?: DatasetFilters;
  includeCount?: boolean;
  currency?: string;
}

export type FetchDatasetCountOptions = Pick<
  FetchDatasetPageOptions,
  "accessToken" | "signal" | "dataset" | "search" | "searchValues" | "filters" | "currency"
>;

export interface CurrencyTotal {
  currency: string;
  reportedAmount: DecimalString | null;
  serviceFee: DecimalString | null;
  companyAmount: DecimalString | null;
  rowCount: number;
  missingFeeCount: number;
}

export interface MarketplaceCurrencyTotal extends CurrencyTotal {
  marketplace: string;
}

export type TransactionSummaryScope = Omit<DatasetFilters, "dateFrom" | "dateTo"> & {
  search: string;
};

export interface FetchLatestTransactionDateOptions {
  accessToken: string;
  signal?: AbortSignal;
}

export interface FetchTransactionPeriodTotalsOptions
  extends FetchLatestTransactionDateOptions, TransactionSummaryScope {
  dateFrom: string;
  dateTo: string;
  searchValues?: TransactionSearchValues | null;
}

export interface FetchTransactionTypeTotalsOptions extends FetchTransactionPeriodTotalsOptions {
  currency: string;
}

export interface TransactionTypeTotal extends CurrencyTotal {
  type: string;
}

export type TransactionTrendGranularity = "day" | "week";

export interface FetchTransactionTrendsOptions extends FetchTransactionPeriodTotalsOptions {
  granularity: TransactionTrendGranularity;
}

export interface TransactionTrendTotal extends MarketplaceCurrencyTotal {
  periodStart: string;
  type: string;
}
