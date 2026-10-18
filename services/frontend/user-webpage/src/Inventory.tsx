import { useEffect, useState } from "react";
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
import type { InventoryViewState, ViewStateProps } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { getErrorMessage } from "./view-model";
import { InventoryTable } from "./InventoryTable";
import { InventoryDetail } from "./InventoryDetail";
import { inventoryRowId } from "./inventory-row";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { RowsSelect } from "./RowsSelect";
import { useInventoryData } from "./use-inventory-data";
import { InventoryCoverage } from "./InventoryCoverage";
import { InventoryAppliedFilters } from "./InventoryAppliedFilters";
import { inventoryEmptyMessage } from "./inventory-coverage";
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
  const { query, rows, denied, filterOptions, captures, availability, hasItems } = useInventoryData(
    identity,
    pageState,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // Age labels change without downloading inventory or waiting for a source revision.
    const timer = globalThis.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);
  const totalCount = denied ? null : (query.data?.totalCount ?? null);
  const finalPage = totalCount === null ? null : lastPageIndex(totalCount, viewState.pageSize);
  const pageCount = finalPage === null ? null : finalPage + 1;
  useEffect(() => {
    if (finalPage !== null && viewState.pageIndex > finalPage)
      onViewStateChange((current) => ({ ...current, pageIndex: finalPage, selectedRowId: null }));
  }, [finalPage, viewState.pageIndex, onViewStateChange]);
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
          data={[
            { value: "", label: "All marketplaces" },
            ...marketplaces.map((value) => ({
              value,
              label:
                captures.isSuccess &&
                !captures.data.some((capture) => capture.marketplace_name === value)
                  ? `${value} — no snapshot`
                  : value,
            })),
          ]}
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
      <InventoryAppliedFilters state={viewState} onChange={changeFilters} />
      {captures.isSuccess ? (
        <InventoryCoverage captures={captures.data} marketplace={viewState.marketplace} now={now} />
      ) : captures.isPending ? (
        <Text size="sm" c="dimmed" role="status">
          Checking inventory snapshot coverage…
        </Text>
      ) : (
        <Alert role="alert" color="red">
          Could not check inventory snapshot coverage. {getErrorMessage(captures.error)} Updates
          retry automatically.
        </Alert>
      )}
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
      {availability.isError && rows.length === 0 ? (
        <Alert role="alert" color="red">
          Could not check unfiltered inventory availability. Updates retry automatically.
        </Alert>
      ) : null}
      <PaginationBar {...pagination} ariaLabel="Inventory pagination, top" />
      <InventoryTable
        onShowTransactions={showTransactions}
        rows={rows}
        viewState={viewState}
        onChange={changeFilters}
        filterOptions={filterOptions.data}
        onSelect={selectRow}
        now={now}
      />
      {!query.isPending && !query.isError && !availability.isError && rows.length === 0 ? (
        <Text role="status">
          {inventoryEmptyMessage({
            captures: captures.isSuccess ? captures.data : undefined,
            marketplace: viewState.marketplace,
            hasItems,
            member: identity.account.access_role === "member",
          })}
        </Text>
      ) : null}
      <PaginationBar {...pagination} />
      <InventoryDetail
        row={selectedRow}
        onClose={() => {
          selectRow(null);
        }}
        onShowTransactions={showTransactions}
        now={now}
      />
    </Stack>
  );
}
