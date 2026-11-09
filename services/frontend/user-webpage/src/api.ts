import { createApiClient } from "./api/client.ts";
import { readRuntimeConfig } from "./api/runtime-config.ts";
import type { PublishSkuConfigurationOptions } from "./api/sku-configuration-types.ts";
import type { SetCompanyMembershipOptions } from "./api/membership.ts";
import type { FetchInventoryPageOptions } from "./api/inventory.ts";
import type { FinancialSourceSelection } from "./api/financial-source.ts";
import type { CurrentSourceScope, ReportSourceScope } from "./api/source-totals.ts";
import type { FetchPayoutHistoryOptions, FetchPayoutVersionOptions } from "./api/payout-history.ts";
import type {
  FinancialReviewCategory,
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
export { SkuConfigurationError } from "./api/sku-configuration-errors.ts";
export type {
  SkuConfigurationItem,
  SkuConfigurationPeriod,
  SkuConfigurationChange,
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
  defaultClient ??= createApiClient(readRuntimeConfig(import.meta.env, window.location.origin));
  return defaultClient;
}

export const signIn = (email: string, password: string): Promise<Session> =>
  getDefaultClient().signIn(email, password);
export const signUp = (
  email: string,
  password: string,
  redirectTo?: string,
): Promise<Session | null> => getDefaultClient().signUp(email, password, redirectTo);
export const refreshSession = (refreshToken: string): Promise<Session> =>
  getDefaultClient().refreshSession(refreshToken);
export const fetchSessionUser = (accessToken: string): Promise<SessionUser> =>
  getDefaultClient().fetchSessionUser(accessToken);
export const signOut = (accessToken: string): Promise<void> =>
  getDefaultClient().signOut(accessToken);
export const requestPasswordRecovery = (email: string, redirectTo: string): Promise<void> =>
  getDefaultClient().requestPasswordRecovery(email, redirectTo);
export const updatePassword = (accessToken: string, password: string): Promise<SessionUser> =>
  getDefaultClient().updatePassword(accessToken, password);
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
export const fetchInventoryCaptures = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchInventoryCaptures(accessToken, signal);
export const hasInventoryItems = (accessToken: string, marketplace: string, signal?: AbortSignal) =>
  getDefaultClient().hasInventoryItems(accessToken, marketplace, signal);

export const fetchFinancialSourceRecord = (
  accessToken: string,
  selection: FinancialSourceSelection,
  signal?: AbortSignal,
) => getDefaultClient().fetchFinancialSourceRecord(accessToken, selection, signal);
export const fetchFinancialSourceTransactions = (
  accessToken: string,
  transactionId: string,
  pageIndex = 0,
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialSourceTransactions(
    accessToken,
    transactionId,
    pageIndex,
    signal,
  );

export const fetchPayoutReadiness = (
  accessToken: string,
  month: string,
  companyIds: string[] = [],
  pageIndex = 0,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutReadiness(accessToken, month, companyIds, pageIndex, signal);
export const fetchFinancialReviewFamilyTypes = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  currency: string,
  marketplace: string,
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialReviewFamilyTypes(
    accessToken,
    category,
    month,
    currency,
    marketplace,
    signal,
  );
export const fetchPayoutSetupBlockers = (
  accessToken: string,
  companyId: string,
  month: string,
  pageIndex = 0,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutSetupBlockers(accessToken, companyId, month, pageIndex, signal);
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
export const fetchPayoutRecords = (
  accessToken: string,
  reportId: string,
  authoritative: boolean,
  pageIndex: number,
  signal?: AbortSignal,
  types: string[] = [],
) =>
  getDefaultClient().fetchPayoutRecords(
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

export const fetchCurrentSourceTotals = (
  accessToken: string,
  scope: CurrentSourceScope,
  signal?: AbortSignal,
) => getDefaultClient().fetchCurrentSourceTotals(accessToken, scope, signal);
export const fetchReportSourceTotals = (
  accessToken: string,
  scope: ReportSourceScope,
  signal?: AbortSignal,
) => getDefaultClient().fetchReportSourceTotals(accessToken, scope, signal);

export const fetchFinancialReviewBounds = (
  accessToken: string,
  category: FinancialReviewCategory,
  marketplace: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchFinancialReviewBounds(accessToken, category, marketplace, signal);
export const fetchFinancialReviewPeriodTypes = (
  accessToken: string,
  category: FinancialReviewCategory,
  year: string,
  currency: string,
  marketplace: string,
  signal?: AbortSignal,
) =>
  getDefaultClient().fetchFinancialReviewPeriodTypes(
    accessToken,
    category,
    year,
    currency,
    marketplace,
    signal,
  );
export const fetchFinancialReviewTypes = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  currency: string,
  marketplace: string,
  pageIndex = 0,
  signal?: AbortSignal,
  familyIds: readonly string[] = [],
) =>
  getDefaultClient().fetchFinancialReviewTypes(
    accessToken,
    category,
    month,
    currency,
    marketplace,
    pageIndex,
    signal,
    familyIds,
  );
export const fetchFinancialReviewRecords = (
  accessToken: string,
  category: FinancialReviewCategory,
  month: string,
  currency: string,
  marketplace: string,
  pageIndex: number,
  filters: FinancialReviewRecordFilters = {},
  signal?: AbortSignal,
  familyIds: readonly string[] = [],
) =>
  getDefaultClient().fetchFinancialReviewRecords(
    accessToken,
    category,
    month,
    currency,
    marketplace,
    pageIndex,
    filters,
    signal,
    familyIds,
  );

export const setCompanyMembership = (options: SetCompanyMembershipOptions) =>
  getDefaultClient().setCompanyMembership(options);
export const createCompany = (accessToken: string, name: string) =>
  getDefaultClient().createCompany(accessToken, name);
export const deleteCompany = (accessToken: string, companyId: string) =>
  getDefaultClient().deleteCompany(accessToken, companyId);
export type { CreateCompanyResult, DeleteCompanyResult } from "./api/companies.ts";
export { CompanyDeletionBlockedError } from "./api/company-errors.ts";
