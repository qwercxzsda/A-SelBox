import { createApiClient } from "./api/client.ts";
import { readBuildConfig } from "./api/runtime-config.ts";
import type { PublishSkuConfigurationOptions } from "./api/sku-configuration-types.ts";
import type { FetchInventoryPageOptions } from "./api/inventory.ts";
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
export const generatePayoutReports = (accessToken: string, companyId: string, month: string) =>
  getDefaultClient().generatePayoutReports(accessToken, companyId, month);
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
) =>
  getDefaultClient().fetchPayoutComponents(accessToken, reportId, authoritative, pageIndex, signal);

export const fetchPayoutReconciliation = (
  accessToken: string,
  reportId: string,
  pageIndex: number,
  signal?: AbortSignal,
) => getDefaultClient().fetchPayoutReconciliation(accessToken, reportId, pageIndex, signal);
