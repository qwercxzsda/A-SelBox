import { queryOptions } from "@tanstack/react-query";
import { ApiError, fetchDatasetCount, fetchDatasetPage } from "./api.ts";
import type { PageResult } from "./api/types.ts";
import {
  acceptDatasetCount,
  createDatasetScope,
  invalidateDatasetCount,
  type DatasetCountOptions,
  type DatasetPageOptions,
  type DatasetQueryIdentity,
} from "./dataset-query-cache.ts";
import { isPolledDataset } from "./workspace-revisions.ts";

export function datasetQueryOptions(
  identity: DatasetQueryIdentity,
  options: DatasetPageOptions,
  fetchPage = fetchDatasetPage,
) {
  const scope = createDatasetScope(identity, options);
  const { sort, pageSize, pageIndex } = options;
  return queryOptions({
    queryKey: [...scope.key, sort.column, sort.direction, pageSize, pageIndex],
    queryFn: async ({ signal, client }) => {
      let result: PageResult;
      try {
        result = await fetchPage({
          ...options,
          filters: scope.filters,
          searchValues: scope.searchValues,
          accessToken: identity.session.access_token,
          signal,
          includeCount: false,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 416) throw error;
        // An unknown bound is recovered independently without delaying this empty page.
        result = { rows: [], totalCount: null };
      }
      signal.throwIfAborted();
      if (result.totalCount !== null) {
        await invalidateDatasetCount(client, scope, signal);
        await acceptDatasetCount(client, scope, result.totalCount);
        signal.throwIfAborted();
        client.setQueryData(scope.countKey, result.totalCount);
      } else {
        const cachedCount = client.getQueryData<number>(scope.countKey);
        const contradictsCount =
          cachedCount !== undefined &&
          result.rows.length > 0 &&
          pageIndex * pageSize + result.rows.length > cachedCount;
        if ((pageIndex > 0 && result.rows.length === 0) || contradictsCount)
          await invalidateDatasetCount(client, scope, signal);
      }
      return result;
    },
  });
}

export function datasetCountQueryOptions(
  identity: DatasetQueryIdentity,
  options: DatasetCountOptions,
  fetchCount = fetchDatasetCount,
) {
  const scope = createDatasetScope(identity, options);
  return queryOptions({
    queryKey: scope.countKey,
    // Financial counts follow source revisions; account and payout lists refresh by polling.
    staleTime: isPolledDataset(options.dataset) ? 30_000 : Infinity,
    queryFn: async ({ signal, client }) => {
      const total = await fetchCount({
        ...options,
        filters: scope.filters,
        searchValues: scope.searchValues,
        accessToken: identity.session.access_token,
        signal,
      });
      signal.throwIfAborted();
      const contradictoryPages = await acceptDatasetCount(client, scope, total);
      signal.throwIfAborted();
      if (contradictoryPages.length > 0) {
        void client.refetchQueries(
          { predicate: (query) => contradictoryPages.includes(query.queryHash), type: "active" },
          { cancelRefetch: false },
        );
      }
      return total;
    },
  });
}
