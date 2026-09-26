import { createApiClient } from "./api/client.ts";
import { readBuildConfig } from "./api/runtime-config.ts";
import type {
  CanonicalRow,
  Company,
  CurrencyTotal,
  TableDatasetKey,
  DatasetFilterField,
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
export const fetchSkuFees = (
  accessToken: string,
  sellerSkuId: string,
  signal?: AbortSignal,
): Promise<CanonicalRow[]> => getDefaultClient().fetchSkuFees(accessToken, sellerSkuId, signal);
export const fetchDatasetFilterOptions = (
  accessToken: string,
  dataset: TableDatasetKey,
  field: DatasetFilterField,
  signal?: AbortSignal,
): Promise<string[]> =>
  getDefaultClient().fetchDatasetFilterOptions(accessToken, dataset, field, signal);

export const fetchLatestTransactionDate = (
  options: FetchLatestTransactionDateOptions,
): Promise<string | null> => getDefaultClient().fetchLatestTransactionDate(options);

export const fetchTransactionPeriodTotals = (
  options: FetchTransactionPeriodTotalsOptions,
): Promise<CurrencyTotal[]> => getDefaultClient().fetchTransactionPeriodTotals(options);

export const fetchTransactionTypeTotals = (
  options: FetchTransactionTypeTotalsOptions,
): Promise<TransactionTypeTotal[]> => getDefaultClient().fetchTransactionTypeTotals(options);
