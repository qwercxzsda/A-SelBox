import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Alert,
  Button,
  CloseButton,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ApiError, fetchInventoryFilterOptions, fetchInventoryPage } from "./api";
import type { InventoryViewState, ViewStateProps } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { getErrorMessage } from "./view-model";
import { InventoryTable } from "./InventoryTable";
import { InventoryDetail } from "./InventoryDetail";
import { inventoryRowId } from "./inventory-row";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import { resolveInventorySearch } from "./inventory-options";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { RowsSelect } from "./RowsSelect";
import "./Inventory.css";

export function Inventory({
  identity,
  viewState,
  onViewStateChange,
  onShowTransactions,
}: ViewStateProps<InventoryViewState> & {
  identity: Identity;
  onShowTransactions: (sku: string) => void;
}) {
  const { selectedRowId, ...pageState } = viewState;
  const [debouncedSearch] = useDebouncedValue(viewState.search.trim(), 250);
  const queryState = { ...pageState, search: debouncedSearch };
  const scope = [
    identity.account.user_id,
    identity.account.access_role,
    identity.account.company_id,
  ];
  const filterOptions = useQuery({
    queryKey: ["inventory", ...scope, "filter-options"],
    queryFn: ({ signal }) => fetchInventoryFilterOptions(identity.session.access_token, signal),
    staleTime: Infinity,
  });
  const searching = Boolean(debouncedSearch);
  const searchValues = filterOptions.data
    ? resolveInventorySearch(debouncedSearch, filterOptions.data)
    : null;
  const query = useQuery({
    queryKey: [
      "inventory",
      identity.account.user_id,
      identity.account.access_role,
      identity.account.company_id,
      queryState,
      searchValues,
    ],
    enabled: !searching || Boolean(filterOptions.data),
    queryFn: ({ signal }) =>
      fetchInventoryPage({
        ...queryState,
        searchValues,
        accessToken: identity.session.access_token,
        signal,
      }),
  });
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status ?? 0);
  const totalCount = denied ? null : (query.data?.totalCount ?? null);
  const finalPage = totalCount === null ? null : lastPageIndex(totalCount, viewState.pageSize);
  const pageCount = finalPage === null ? null : finalPage + 1;
  useEffect(() => {
    if (finalPage !== null && viewState.pageIndex > finalPage)
      onViewStateChange((current) => ({ ...current, pageIndex: finalPage, selectedRowId: null }));
  }, [finalPage, viewState.pageIndex, onViewStateChange]);
  const rows = denied ? [] : (query.data?.rows ?? []);
  const selectedRow = rows.find((row) => inventoryRowId(row) === selectedRowId) ?? null;
  useEffect(() => {
    if (selectedRowId && !query.isFetching && (denied || (query.isSuccess && !selectedRow)))
      onViewStateChange((current) => ({ ...current, selectedRowId: null }));
  }, [selectedRowId, query.isFetching, query.isSuccess, denied, selectedRow, onViewStateChange]);
  const filtered = Boolean(
    viewState.search ||
    viewState.marketplace ||
    viewState.skus.length ||
    viewState.healthStatuses.length ||
    viewState.recommendations.length,
  );
  const changePage = (pageIndex: number) => {
    onViewStateChange((current) => ({ ...current, pageIndex, selectedRowId: null }));
  };
  const changeFilters = (patch: Partial<InventoryViewState>) => {
    onViewStateChange((current) => ({ ...current, ...patch, pageIndex: 0, selectedRowId: null }));
  };
  function selectRow(id: string | null) {
    onViewStateChange((current) => ({ ...current, selectedRowId: id }));
  }
  function showTransactions(sku: string) {
    selectRow(null);
    onShowTransactions(sku);
  }
  const pagination = {
    pageIndex: viewState.pageIndex,
    pageCount,
    canPrevious: viewState.pageIndex > 0,
    canNext:
      pageCount === null ? rows.length === viewState.pageSize : viewState.pageIndex + 1 < pageCount,
    isBusy: query.isFetching,
    onPrevious: () => {
      changePage(viewState.pageIndex - 1);
    },
    onNext: () => {
      changePage(viewState.pageIndex + 1);
    },
    onPageChange: changePage,
    summary:
      totalCount === null
        ? `${String(rows.length)} inventory items`
        : `${String(totalCount)} inventory ${totalCount === 1 ? "item" : "items"}`,
  };
  return (
    <Stack gap="md" className="inventory-panel">
      <WorkspaceIntro
        title="Inventory"
        description="Daily snapshots for approximate replenishment planning. Sales are historical, not a forecast. A dash means unavailable; zero is a reported value. Source dates can differ from the capture date."
      />
      <Group align="end" className="inventory-filters">
        <TextInput
          label="Search"
          placeholder="SKU, marketplace, health or recommendation"
          value={viewState.search}
          type="search"
          rightSectionPointerEvents="auto"
          rightSection={
            viewState.search ? (
              <CloseButton
                aria-label="Clear search"
                onClick={() => {
                  changeFilters({ search: "" });
                }}
              />
            ) : undefined
          }
          onChange={(event) => {
            changeFilters({ search: event.currentTarget.value });
          }}
        />
        <NativeSelect
          label="Marketplace"
          value={viewState.marketplace}
          data={[{ value: "", label: "All marketplaces" }, ...marketplaces]}
          onChange={(event) => {
            changeFilters({ marketplace: event.currentTarget.value });
          }}
        />
        <RowsSelect
          value={viewState.pageSize}
          onChange={(pageSize) => {
            changeFilters({ pageSize });
          }}
        />
        {filtered ? (
          <Button
            variant="subtle"
            onClick={() => {
              changeFilters({
                search: "",
                skus: [],
                healthStatuses: [],
                recommendations: [],
                marketplace: "",
              });
            }}
          >
            Clear inventory filters
          </Button>
        ) : null}
      </Group>
      {filterOptions.isError && !query.isError ? (
        <Alert role="alert" color="red">
          Could not load inventory filter options. {getErrorMessage(filterOptions.error)} Updates
          retry automatically.
        </Alert>
      ) : null}
      {query.isError ? (
        <Alert role="alert" color="red">
          Could not load inventory. {getErrorMessage(query.error)}
          {query.data && !denied ? " Previously loaded values are shown." : ""}
          {" Updates retry automatically."}
        </Alert>
      ) : null}
      {query.isFetching ? (
        <Text role="status">{query.isPending ? "Loading inventory…" : "Updating inventory…"}</Text>
      ) : null}
      <PaginationBar {...pagination} ariaLabel="Inventory pagination, top" />
      <InventoryTable
        onShowTransactions={showTransactions}
        rows={rows}
        viewState={viewState}
        onChange={changeFilters}
        filterOptions={filterOptions.data}
        onSelect={selectRow}
      />
      {!query.isPending && !query.isError && rows.length === 0 ? (
        <Text role="status">
          {filtered
            ? "No inventory matches these filters."
            : "No inventory items are available for your account."}
        </Text>
      ) : null}
      <PaginationBar {...pagination} />
      <InventoryDetail
        row={selectedRow}
        onClose={() => {
          selectRow(null);
        }}
        onShowTransactions={showTransactions}
      />
    </Stack>
  );
}
