import { hashKey, type Query, type QueryClient } from "@tanstack/react-query";
import type { FetchDatasetCountOptions, FetchDatasetPageOptions, PageResult } from "./api/types.ts";
import { normalizeDatasetFilters } from "./dataset-filters.ts";
import { lastPageIndex } from "./pagination.ts";
import type { Identity } from "./auth-session.ts";
import { isTransactionDataset } from "./api/transaction-page.ts";
import { resolveTransactionSearch } from "./transaction-search.ts";

export type DatasetQueryIdentity = Pick<Identity, "session" | "account" | "skuOptions">;
export type DatasetPageOptions = Omit<
  FetchDatasetPageOptions,
  "accessToken" | "signal" | "includeCount" | "searchValues"
>;
export type DatasetCountOptions = Omit<
  FetchDatasetCountOptions,
  "accessToken" | "signal" | "searchValues"
>;

export function createDatasetScope(identity: DatasetQueryIdentity, options: DatasetCountOptions) {
  const filters = normalizeDatasetFilters(options.filters);
  const { access_role, company_id } = identity.account;
  const searchValues = isTransactionDataset(options.dataset)
    ? resolveTransactionSearch(options.dataset, access_role, identity.skuOptions, options.search)
    : null;
  const membership = [
    identity.session.user.id,
    access_role,
    company_id,
    options.dataset,
    options.search,
    filters,
    searchValues,
  ] as const;
  const key = ["dataset", ...membership] as const;
  const scopeHash = hashKey(key);
  return {
    key,
    filters,
    searchValues,
    countKey: ["dataset-count", ...membership] as const,
    // Partial query-key matching treats empty filter arrays as wildcards.
    matches: (query: Query) => hashKey(query.queryKey.slice(0, key.length)) === scopeHash,
  };
}

type DatasetScope = ReturnType<typeof createDatasetScope>;

/** A late count from before a vanished page must not replace its newly invalidated bound. */
export async function invalidateDatasetCount(
  client: QueryClient,
  scope: DatasetScope,
  signal: AbortSignal,
) {
  await client.cancelQueries({ queryKey: scope.countKey, exact: true });
  signal.throwIfAborted();
  await client.invalidateQueries({ queryKey: scope.countKey, exact: true, refetchType: "none" });
}

/** Invalidate stale pages before clamping; refresh only active pages proven inconsistent. */
export async function acceptDatasetCount(client: QueryClient, scope: DatasetScope, total: number) {
  const previous = client.getQueryData<number>(scope.countKey);
  const contradictory = client
    .getQueryCache()
    .findAll({ queryKey: scope.key, predicate: scope.matches })
    .flatMap((query) => {
      const page = client.getQueryData<PageResult>(query.queryKey);
      const pageSize = query.queryKey.at(-2);
      const pageIndex = query.queryKey.at(-1);
      if (!page?.rows.length || typeof pageSize !== "number" || typeof pageIndex !== "number")
        return [];
      return pageIndex * pageSize + page.rows.length > total
        ? [{ query, pageSize, pageIndex }]
        : [];
    });
  if ((previous !== undefined && previous !== total) || contradictory.length > 0) {
    await client.invalidateQueries({
      queryKey: scope.key,
      predicate: scope.matches,
      refetchType: "none",
    });
  }
  return contradictory
    .filter(
      ({ query, pageSize, pageIndex }) =>
        query.isActive() &&
        query.state.fetchStatus === "idle" &&
        pageIndex <= lastPageIndex(total, pageSize),
    )
    .map(({ query }) => query.queryHash);
}
