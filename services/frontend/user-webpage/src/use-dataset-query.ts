import { useEffect, useEffectEvent } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { datasetCountQueryOptions, datasetQueryOptions } from "./dataset-queries.ts";
import type { DatasetPageOptions, DatasetQueryIdentity } from "./dataset-query-cache.ts";

export function useDatasetQuery(identity: DatasetQueryIdentity, options: DatasetPageOptions) {
  const client = useQueryClient();
  const pageOptions = datasetQueryOptions(identity, options);
  const countOptions = datasetCountQueryOptions(identity, options);
  const query = useQuery(pageOptions);
  const countQuery = useQuery({
    ...countOptions,
    enabled: query.isSuccess && !query.isFetching,
  });
  const pageHash = hashKey(pageOptions.queryKey);
  const acquireCount = useEffectEvent((completedPageHash: string) => {
    // An old page can finish between a scope change and its effect cleanup.
    if (completedPageHash !== pageHash) return;
    void client.query(countOptions).catch(() => {
      // The count observer exposes its own error and Retry action.
    });
  });
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success" && !event.action.manual) {
          // Fast refetches can finish within one React batch. Keep this subscription
          // stable while using the latest credentials to acquire/dedupe the count.
          acquireCount(event.query.queryHash);
        }
      }),
    [client],
  );
  return {
    ...query,
    countQuery,
    totalCount:
      countQuery.isError || client.getQueryState(countOptions.queryKey)?.isInvalidated
        ? null
        : (countQuery.data ?? null),
  };
}
