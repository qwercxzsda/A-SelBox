import { createApiClient } from "./api/client.ts";
import { readBuildConfig } from "./api/runtime-config.ts";
import type { PublishSkuConfigurationOptions } from "./api/sku-configuration-types.ts";
import type { FetchInventoryPageOptions } from "./api/inventory.ts";
import type { FetchPayoutHistoryOptions, FetchPayoutVersionOptions } from "./api/payout-history.ts";
import type {
  FinancialReviewCategory,
  FinancialReviewPageCursor,
  FinancialReviewRecordFilters,
} from "./api/financial-review.ts";
import type {
  Company,
  CurrencyTotal,
  FetchDatasetPageOptions,
  FetchDatasetCountOptions,
  FetchLatestTransactionDateOptions,
  FetchTransactionPeriodTotalsOptions,
  FetchTransactionTypeTotalsOptions,
  PageResult,
  Session,
  SessionUser,
  SkuAssignment,
  TransactionTypeTotal,
  FetchWorkspaceRevisionsOptions,
  WorkspaceRevisionSnapshot,
} from "./api/types.ts";

export { ApiError } from "./api/transport.ts";
export type {
  FinancialReviewCategory,
  FinancialReviewSource,
  FinancialReviewRecordFilters,
  FinancialReviewMonthPage,
  FinancialReviewPageCursor,
} from "./api/financial-review.ts";
export { SkuConfigurationError } from "./api/sku-configuration-errors.ts";
export type {
  SkuConfiguration,
  SkuConfigurationItem,
  SkuConfigurationPeriod,
  SkuConfigurationRequirement,
  SkuConfigurationIssue,
  SkuConfigurationChange,
  PublishSkuConfigurationOptions,
  PublishSkuConfigurationResult,
} from "./api/sku-configuration-types.ts";
export { DATASET_CONFIG } from "./api/config.ts";
export type {
  AppAccount,
  CanonicalRow,
  Company,
  CurrencyTotal,
  DatasetFilters,
  DatasetKey,
  TableDatasetKey,
  Session,
  SkuAssignment,
  WorkspaceRevisions,
} from "./api/types.ts";

let defaultClient: ReturnType<typeof createApiClient> | undefined;
function getDefaultClient(): ReturnType<typeof createApiClient> {
  defaultClient ??= createApiClient(readBuildConfig(import.meta.env));
  return defaultClient;
}

export const signIn = (email: string, password: string): Promise<Session> =>
  getDefaultClient().signIn(email, password);
export const refreshSession = (refreshToken: string): Promise<Session> =>
  getDefaultClient().refreshSession(refreshToken);
export const fetchSessionUser = (accessToken: string): Promise<SessionUser> =>
  getDefaultClient().fetchSessionUser(accessToken);
export const signOut = (accessToken: string): Promise<void> =>
  getDefaultClient().signOut(accessToken);
export const fetchWorkspaceRevisions = (
  options: FetchWorkspaceRevisionsOptions,
): Promise<WorkspaceRevisionSnapshot> => getDefaultClient().fetchWorkspaceRevisions(options);
export const fetchCompanies = (accessToken: string): Promise<Company[]> =>
  getDefaultClient().fetchCompanies(accessToken);
export const fetchSkuAssignments = (accessToken: string): Promise<SkuAssignment[]> =>
  getDefaultClient().fetchSkuAssignments(accessToken);
export const fetchDatasetPage = (options: FetchDatasetPageOptions): Promise<PageResult> =>
  getDefaultClient().fetchDatasetPage(options);
export const fetchDatasetCount = (options: FetchDatasetCountOptions): Promise<number> =>
  getDefaultClient().fetchDatasetCount(options);
export const fetchSkuOptions = (accessToken: string, signal?: AbortSignal): Promise<string[]> =>
  getDefaultClient().fetchSkuOptions(accessToken, signal);
export const fetchInventoryPage = (options: FetchInventoryPageOptions) =>
  getDefaultClient().fetchInventoryPage(options);
export const fetchInventoryFilterOptions = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchInventoryFilterOptions(accessToken, signal);
export const fetchSkuConfiguration = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchSkuConfiguration(accessToken, signal);
export const publishSkuConfiguration = (options: PublishSkuConfigurationOptions) =>
  getDefaultClient().publishSkuConfiguration(options);

export const fetchLatestTransactionDate = (
  options: FetchLatestTransactionDateOptions,
): Promise<string | null> => getDefaultClient().fetchLatestTransactionDate(options);

export const fetchTransactionPeriodTotals = (
  options: FetchTransactionPeriodTotalsOptions,
): Promise<CurrencyTotal[]> => getDefaultClient().fetchTransactionPeriodTotals(options);

export const fetchTransactionTypeTotals = (
  options: FetchTransactionTypeTotalsOptions,
): Promise<TransactionTypeTotal[]> => getDefaultClient().fetchTransactionTypeTotals(options);

export const fetchPayoutPolicy = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchPayoutPolicy(accessToken, signal);
export const fetchPayoutHistory = (options: FetchPayoutHistoryOptions): Promise<PageResult> =>
  getDefaultClient().fetchPayoutHistory(options);
export const fetchPayoutVersion = (options: FetchPayoutVersionOptions) =>
  getDefaultClient().fetchPayoutVersion(options);
export const fetchPayoutMarketplaceTotals = (
  accessToken: string,
  reportId: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutMarketplaceTotals(accessToken, reportId, signal);
export const fetchPayoutComponents = (
  accessToken: string,
  reportId: string,
  authoritative: boolean,
  pageIndex: number,
  signal?: AbortSignal,
  types: string[] = [],
) =>
  getDefaultClient().fetchPayoutComponents(
    accessToken,
    reportId,
    authoritative,
    pageIndex,
    signal,
    types,
  );

export const fetchPayoutTypeTotals = (
  accessToken: string,
  reportId: string,
  currency: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutTypeTotals(accessToken, reportId, currency, signal);

export const fetchPayoutReconciliation = (
  accessToken: string,
  reportId: string,
  pageIndex: number,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutReconciliation(accessToken, reportId, pageIndex, signal);

export const fetchPayoutReconciliationTotals = (
  accessToken: string,
  reportId: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutReconciliationTotals(accessToken, reportId, signal);

export const fetchFinancialReviewMonths = (
  accessToken: string,
  category: FinancialReviewCategory,
  cursor: FinancialReviewPageCursor | null,
  pageSize: number,
  filterMonth: string,
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialReviewMonths(
    accessToken,
    category,
    cursor,
    pageSize,
    filterMonth,
    signal,
  );
export const fetchFinancialReviewTotals = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchFinancialReviewTotals(accessToken, category, month, signal);
export const fetchFinancialReviewTypes = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  currency: string,
  pageIndex = 0,
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialReviewTypes(
    accessToken,
    category,
    month,
    currency,
    pageIndex,
    signal,
  );
export const fetchFinancialReviewRecords = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  currency: string,
  pageIndex: number,
  filters: FinancialReviewRecordFilters = {},
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialReviewRecords(
    accessToken,
    category,
    month,
    currency,
    pageIndex,
    filters,
    signal,
  );
