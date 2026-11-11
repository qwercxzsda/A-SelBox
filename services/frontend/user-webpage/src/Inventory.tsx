import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, NativeSelect, Stack, Text } from "@mantine/core";
import type { InventoryViewState, ViewStateProps } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { getErrorMessage } from "./view-model";
import { InventoryTable } from "./InventoryTable";
import { InventoryDetail } from "./InventoryDetail";
import { inventoryRowId } from "./inventory-row";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { RowsSelect } from "./RowsSelect";
import { useInventoryData } from "./use-inventory-data";
import { InventoryAppliedFilters } from "./InventoryAppliedFilters";
import { inventoryEmptyMessage } from "./inventory-coverage";
import { SearchInput } from "./SearchInput";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
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
  const searchInput = useRef<HTMLInputElement>(null);
  const pageStart = useRef<HTMLDivElement>(null);
  const { selectedRowId, ...pageState } = viewState;
  const {
    query,
    rows,
    totalCount: itemCount,
    denied,
    skus,
    captures,
    hasItems,
  } = useInventoryData(identity, pageState);
  const isLoading = query.isPending;
  const isUnavailable = denied || (!query.data && query.isError);
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
  const totalCount = query.data && !denied ? itemCount : null;
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
    const target = pageStart.current;
    if (target && target.getBoundingClientRect().top < 0) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }
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
    isBusy: isLoading || query.isFetching,
    onPrevious: () => {
      changePage(viewState.pageIndex - 1);
    },
    onNext: () => {
      changePage(viewState.pageIndex + 1);
    },
    onPageChange: changePage,
    summary: isUnavailable
      ? "Inventory unavailable"
      : isLoading
        ? "Loading inventory…"
        : totalCount === null
          ? `${String(rows.length)} inventory items`
          : `${String(totalCount)} inventory ${totalCount === 1 ? "item" : "items"}`,
  };
  return (
    <Stack gap="md" className="inventory-panel">
      <WorkspaceHeader
        title="Inventory"
        help={
          <>
            <p>Latest imported stock and replenishment recommendations for each marketplace.</p>
            <ul>
              <li>Select a SKU to view its transactions, or a row to open inventory details.</li>
              <li>
                Use column headings to filter or sort. Replenishment actions have the highest
                priority.
              </li>
              <li>
                Each row shows its stock date and age. Dates more than two marketplace-local days
                old are marked Out of date.
              </li>
              <li>
                Sales are historical; quantities are estimates. A dash means unavailable, while zero
                is a reported value.
              </li>
            </ul>
          </>
        }
      />
      <Group align="end" className="inventory-filters">
        <SearchInput
          inputRef={searchInput}
          placeholder="SKU, marketplace, health, or recommendation"
          value={viewState.search}
          type="search"
          onChange={(search) => {
            changeFilters({ search });
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
            className="inventory-clear-filters"
            variant="subtle"
            onClick={(event) => {
              if (event.detail === 0) searchInput.current?.focus();
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
      <InventoryAppliedFilters
        state={viewState}
        onChange={changeFilters}
        focusTarget={searchInput}
      />
      {captures.isError && rows.length === 0 ? (
        <Alert role="alert" color="red">
          Could not check inventory availability. {getErrorMessage(captures.error)} Updates retry
          automatically.
        </Alert>
      ) : null}
      {query.isError ? (
        <Alert role="alert" color="red">
          Could not load inventory. {getErrorMessage(query.error)}
          {query.data && !denied ? " Previously loaded values are shown." : ""}
          {" Updates retry automatically."}
        </Alert>
      ) : null}
      {isLoading || query.isFetching ? (
        <Text role="status">{query.isPending ? "Loading inventory…" : "Updating inventory…"}</Text>
      ) : null}
      <div ref={pageStart} tabIndex={-1} className="inventory-page-start">
        <PaginationBar {...pagination} ariaLabel="Inventory pagination, top" />
      </div>
      <InventoryTable
        onShowTransactions={showTransactions}
        rows={rows}
        viewState={viewState}
        onChange={changeFilters}
        skus={skus}
        onSelect={selectRow}
        now={now}
      />
      {!query.isPending && !query.isError && !captures.isError && rows.length === 0 ? (
        <Text role="status">
          {inventoryEmptyMessage({
            captures: captures.isSuccess ? captures.data : undefined,
            marketplace: viewState.marketplace,
            hasItems,
            member: identity.account.access_role === "member",
          })}
        </Text>
      ) : null}
      {rows.length > 10 || viewState.pageIndex > 0 ? (
        <ListPageNavigation
          labels={{
            navigation: "Inventory navigation at bottom",
            items: "inventory items",
            back: "Back to inventory filters",
          }}
          pageIndex={viewState.pageIndex}
          pageCount={pageCount}
          canPrevious={pagination.canPrevious}
          canNext={pagination.canNext}
          isBusy={pagination.isBusy}
          onPageChange={changePage}
          onBackToFilters={() => {
            revealSection(searchInput.current);
          }}
        />
      ) : null}
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
