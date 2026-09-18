import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchDatasetPage } from "./api/client.ts";
import type { FetchDatasetPageOptions, PageResult } from "./api/types.ts";
import type { Identity } from "./use-auth.ts";

type DatasetQueryIdentity = Pick<Identity, "session" | "account">;
type DatasetQueryOptions = Omit<FetchDatasetPageOptions, "accessToken" | "signal">;

export function datasetQueryOptions(
  identity: DatasetQueryIdentity,
  options: DatasetQueryOptions,
  fetchPage = fetchDatasetPage,
) {
  const { session, account } = identity;
  const { dataset, search, sort, pageSize, pageIndex } = options;
  const scope = [
    "dataset",
    session.user.id,
    account.access_role,
    account.company_id,
    dataset,
    search,
  ];
  return queryOptions({
    queryKey: [...scope, sort.column, sort.direction, pageSize, pageIndex],
    queryFn: async ({ signal, client }) => {
      const result = await fetchPage({ ...options, accessToken: session.access_token, signal });
      if (result.totalCount !== null) {
        // A shrinking dataset can clamp navigation onto an otherwise fresh, outdated page.
        await client.invalidateQueries({
          queryKey: scope,
          predicate: (query) => {
            const cached = client.getQueryData<PageResult>(query.queryKey);
            return cached !== undefined && cached.totalCount !== result.totalCount;
          },
          refetchType: "none",
        });
      }
      return result;
    },
  });
}

export function useDatasetQuery(identity: DatasetQueryIdentity, options: DatasetQueryOptions) {
  return useQuery(datasetQueryOptions(identity, options));
}
