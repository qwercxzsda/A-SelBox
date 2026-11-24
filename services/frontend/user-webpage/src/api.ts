import { createApiClient } from "./api/client.ts";
import { readRuntimeConfig } from "./api/runtime-config.ts";
import type { PublishSkuConfigurationOptions } from "./api/sku-configuration-types.ts";
import type { SetCompanyMembershipOptions } from "./api/membership.ts";
import type { FinancialSourceSelection } from "./api/financial-source.ts";
import type { FetchPayoutHistoryOptions, FetchPayoutVersionOptions } from "./api/payout-history.ts";
import type {
  AppAccount,
  Company,
  MarketplaceCurrencyTotal,
  FetchDatasetPageOptions,
  FetchDatasetCountOptions,
  FetchLatestTransactionDateOptions,
  FetchTransactionPeriodTotalsOptions,
  FetchTransactionTypeTotalsOptions,
  FetchTransactionTrendsOptions,
  TransactionTrendTotal,
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
  MarketplaceCurrencyTotal,
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
export const fetchInventoryRows = (
  accessToken: string,
  expectedAccount: AppAccount,
  signal?: AbortSignal,
) => getDefaultClient().fetchInventoryRows(accessToken, expectedAccount, signal);
export const fetchInventoryCaptures = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchInventoryCaptures(accessToken, signal);

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
export const fetchPayoutSetupBlockers = (
  accessToken: string,
  companyId: string,
  month: string,
  pageIndex = 0,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutSetupBlockers(accessToken, companyId, month, pageIndex, signal);
export const fetchSkuConfiguration = (accessToken: string, signal?: AbortSignal) =>
  getDefaultClient().fetchSkuConfiguration(accessToken, signal);
export const fetchSkuConfigurationHistory = (
  accessToken: string,
  skuId: string,
  pageIndex = 0,
  signal?: AbortSignal,
) => getDefaultClient().fetchSkuConfigurationHistory(accessToken, skuId, pageIndex, signal);
export { SKU_CONFIGURATION_HISTORY_PAGE_SIZE } from "./api/sku-configuration-history.ts";
export type {
  SkuConfigurationHistory,
  SkuConfigurationVersion,
} from "./api/sku-configuration-history.ts";
export const publishSkuConfiguration = (options: PublishSkuConfigurationOptions) =>
  getDefaultClient().publishSkuConfiguration(options);

export const fetchLatestTransactionDate = (
  options: FetchLatestTransactionDateOptions,
): Promise<string | null> => getDefaultClient().fetchLatestTransactionDate(options);

export const fetchTransactionPeriodTotals = (
  options: FetchTransactionPeriodTotalsOptions,
): Promise<MarketplaceCurrencyTotal[]> => getDefaultClient().fetchTransactionPeriodTotals(options);

export const fetchTransactionTypeTotals = (
  options: FetchTransactionTypeTotalsOptions,
): Promise<TransactionTypeTotal[]> => getDefaultClient().fetchTransactionTypeTotals(options);

export const fetchTransactionTrends = (
  options: FetchTransactionTrendsOptions,
): Promise<TransactionTrendTotal[]> => getDefaultClient().fetchTransactionTrends(options);

export const fetchPayoutHistory = (options: FetchPayoutHistoryOptions): Promise<PageResult> =>
  getDefaultClient().fetchPayoutHistory(options);
export const fetchPayoutVersion = (options: FetchPayoutVersionOptions) =>
  getDefaultClient().fetchPayoutVersion(options);
export const fetchPayoutRecords = (
  accessToken: string,
  reportId: string,
  pageIndex: number,
  signal?: AbortSignal,
  types: string[] = [],
) => getDefaultClient().fetchPayoutRecords(accessToken, reportId, pageIndex, signal, types);

export const fetchPayoutTypeTotals = (
  accessToken: string,
  reportId: string,
  currency: string,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutTypeTotals(accessToken, reportId, currency, signal);

export const fetchOutcomeMonths = (
  ...args: Parameters<ReturnType<typeof createApiClient>["fetchOutcomeMonths"]>
) => getDefaultClient().fetchOutcomeMonths(...args);
export const fetchFinancialOutcomes = (
  ...args: Parameters<ReturnType<typeof createApiClient>["fetchFinancialOutcomes"]>
) => getDefaultClient().fetchFinancialOutcomes(...args);
export const fetchAssignmentStatus = (
  ...args: Parameters<ReturnType<typeof createApiClient>["fetchAssignmentStatus"]>
) => getDefaultClient().fetchAssignmentStatus(...args);
export const setReferenceAssignment = (
  ...args: Parameters<ReturnType<typeof createApiClient>["setReferenceAssignment"]>
) => getDefaultClient().setReferenceAssignment(...args);

export const setCompanyMembership = (options: SetCompanyMembershipOptions) =>
  getDefaultClient().setCompanyMembership(options);
export const createCompany = (accessToken: string, name: string) =>
  getDefaultClient().createCompany(accessToken, name);
export const deleteCompany = (accessToken: string, companyId: string) =>
  getDefaultClient().deleteCompany(accessToken, companyId);
export type { CreateCompanyResult, DeleteCompanyResult } from "./api/companies.ts";
export { CompanyDeletionBlockedError } from "./api/company-errors.ts";
