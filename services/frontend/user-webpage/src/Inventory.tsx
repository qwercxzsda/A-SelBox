import { useEffect, useRef, useState } from "react";
import { Alert, Button, Text } from "@mantine/core";
import type { InventoryViewState, ViewStateProps } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { companyLabel, getErrorMessage } from "./view-model";
import { InventoryTable } from "./InventoryTable";
import { InventoryDetail } from "./InventoryDetail";
import { inventoryRowId } from "./inventory-row";
import { lastPageIndex } from "./pagination";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useInventoryData } from "./use-inventory-data";
import { InventoryAppliedFilters } from "./InventoryAppliedFilters";
import { inventoryEmptyMessage } from "./inventory-coverage";
import { ListToolbar } from "./ListToolbar";
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
  const administrator = identity.account.access_role === "administrator";
  const companyNames = new Map(identity.companies.map(({ id, name }) => [id, name]));
  const companyIds = administrator ? viewState.companyIds : [];
  const { selectedRowId, ...pageState } = viewState;
  const {
    query,
    rows,
    totalCount: itemCount,
    denied,
    skus,
    captures,
    hasItems,
  } = useInventoryData(identity, { ...pageState, companyIds });
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
    viewState.marketplaces.length ||
    companyIds.length ||
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
  };
  return (
    <div className="inventory-panel">
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
      <ListToolbar
        controlsRef={pageStart}
        label="Inventory controls"
        className="inventory-page-start"
        search={{
          inputRef: searchInput,
          value: viewState.search,
          placeholder: "SKU, marketplace, health, or recommendation",
          onChange: (search) => {
            changeFilters({ search });
          },
        }}
        pageSize={viewState.pageSize}
        onPageSizeChange={(pageSize) => {
          changeFilters({ pageSize });
        }}
        pagination={{ ...pagination, ariaLabel: "Inventory pagination, top" }}
        rowCount={rows.length}
        totalCount={totalCount}
        items="inventory items"
        message={
          isUnavailable ? "Inventory unavailable" : isLoading ? "Loading inventory…" : undefined
        }
        extraControls={
          filtered ? (
            <Button
              variant="subtle"
              onClick={(event) => {
                if (event.detail === 0) searchInput.current?.focus();
                changeFilters({
                  search: "",
                  skus: [],
                  healthStatuses: [],
                  recommendations: [],
                  marketplaces: [],
                  companyIds: [],
                });
              }}
            >
              Clear inventory filters
            </Button>
          ) : undefined
        }
      />
      <InventoryAppliedFilters
        state={{ ...viewState, companyIds }}
        companyNames={companyNames}
        onChange={changeFilters}
        focusTarget={searchInput}
      />
      {captures.isError && rows.length === 0 ? (
        <Alert role="alert" color="red" mb="md">
          Could not check inventory availability. {getErrorMessage(captures.error)} Updates retry
          automatically.
        </Alert>
      ) : null}
      {query.isError ? (
        <Alert role="alert" color="red" mb="md">
          Could not load inventory. {getErrorMessage(query.error)}
          {query.data && !denied ? " Previously loaded values are shown." : ""}
          {" Updates retry automatically."}
        </Alert>
      ) : null}
      {isLoading || query.isFetching ? (
        <Text role="status" mb="sm">
          {query.isPending ? "Loading inventory…" : "Updating inventory…"}
        </Text>
      ) : null}
      <InventoryTable
        onShowTransactions={showTransactions}
        rows={rows}
        viewState={viewState}
        onChange={changeFilters}
        skus={skus}
        administrator={administrator}
        companyNames={companyNames}
        companyOptions={[...new Set([...companyNames.keys(), ...companyIds, null])]
          .map((id) => ({ value: JSON.stringify(id), label: companyLabel(id, companyNames) }))
          .sort((left, right) => left.label.localeCompare(right.label))}
        marketplaceOptions={marketplaces.map((value) => ({
          value,
          label:
            captures.isSuccess &&
            !captures.data.some((capture) => capture.marketplace_name === value)
              ? `${value} — no snapshot`
              : value,
        }))}
        onSelect={selectRow}
        now={now}
      />
      {!query.isPending && !query.isError && !captures.isError && rows.length === 0 ? (
        <Text role="status" mb="sm">
          {inventoryEmptyMessage({
            captures: captures.isSuccess ? captures.data : undefined,
            marketplaces: viewState.marketplaces,
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
    </div>
  );
}
