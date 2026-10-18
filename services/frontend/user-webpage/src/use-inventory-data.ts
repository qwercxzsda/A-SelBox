import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@mantine/hooks";
import {
  ApiError,
  fetchInventoryCaptures,
  fetchInventoryFilterOptions,
  fetchInventoryPage,
  hasInventoryItems,
} from "./api";
import type { Identity } from "./auth-session";
import type { InventoryViewState } from "./workspace-view-state";
import { resolveInventorySearch } from "./inventory-options";

export function useInventoryData(
  identity: Identity,
  state: Omit<InventoryViewState, "selectedRowId">,
) {
  const [search] = useDebouncedValue(state.search.trim(), 250);
  const queryState = { ...state, search };
  const scope = [
    identity.account.user_id,
    identity.account.access_role,
    identity.account.company_id,
  ];
  const captures = useQuery({
    queryKey: ["inventory", ...scope, "captures"],
    queryFn: ({ signal }) => fetchInventoryCaptures(identity.session.access_token, signal),
    staleTime: Infinity,
  });
  const filterOptions = useQuery({
    queryKey: ["inventory", ...scope, "filter-options"],
    queryFn: ({ signal }) => fetchInventoryFilterOptions(identity.session.access_token, signal),
    staleTime: Infinity,
  });
  const searchValues = filterOptions.data
    ? resolveInventorySearch(search, filterOptions.data)
    : null;
  const query = useQuery({
    queryKey: ["inventory", ...scope, queryState, searchValues],
    enabled: !search || Boolean(filterOptions.data),
    queryFn: ({ signal }) =>
      fetchInventoryPage({
        ...queryState,
        searchValues,
        accessToken: identity.session.access_token,
        signal,
      }),
  });
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status ?? 0);
  const rows = denied ? [] : (query.data?.rows ?? []);
  const itemFiltered = Boolean(
    search || state.skus.length || state.healthStatuses.length || state.recommendations.length,
  );
  const covered = captures.data?.some(
    (capture) => !state.marketplace || capture.marketplace_name === state.marketplace,
  );
  const availability = useQuery({
    queryKey: ["inventory", ...scope, "availability", state.marketplace],
    queryFn: ({ signal }) =>
      hasInventoryItems(identity.session.access_token, state.marketplace, signal),
    enabled:
      query.isSuccess &&
      !query.isFetching &&
      rows.length === 0 &&
      itemFiltered &&
      covered === true &&
      !captures.isError,
    staleTime: Infinity,
  });
  return {
    query,
    rows,
    denied,
    filterOptions,
    captures,
    availability,
    hasItems: itemFiltered
      ? availability.data
      : query.isSuccess
        ? (query.data.totalCount ?? rows.length) > 0
        : undefined,
  };
}
