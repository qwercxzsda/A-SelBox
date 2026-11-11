import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@mantine/hooks";
import { ApiError, fetchInventoryCaptures, fetchInventoryRows } from "./api";
import type { Identity } from "./auth-session";
import type { InventoryViewState } from "./workspace-view-state";
import { inventoryPage } from "./inventory-view";

export function useInventoryData(
  identity: Identity,
  state: Omit<InventoryViewState, "selectedRowId">,
) {
  const [search] = useDebouncedValue(state.search.trim(), 250);
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
  const query = useQuery({
    queryKey: ["inventory", ...scope, "items"],
    queryFn: ({ signal }) =>
      fetchInventoryRows(identity.session.access_token, identity.account, signal),
    staleTime: Infinity,
  });
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status ?? 0);
  const page = useMemo(
    () => inventoryPage(denied ? [] : (query.data ?? []), { ...state, search }),
    [query.data, denied, state, search],
  );
  const skus = useMemo(
    () => (denied ? [] : [...new Set(query.data?.map((row) => row.sku))]),
    [query.data, denied],
  );
  return {
    query,
    ...page,
    denied,
    skus,
    captures,
    hasItems:
      query.data && !denied
        ? query.data.some((row) => !state.marketplace || row.marketplace_name === state.marketplace)
        : undefined,
  };
}
