import { useEffect, useRef, useState } from "react";
import type { CorrectableViewStateProps, InventoryViewState } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { companyLabel } from "./view-model";
import { loadErrorDetail } from "./load-error";
import { InventoryTable } from "./InventoryTable";
import { InventoryDetail } from "./InventoryDetail";
import { inventoryRowId } from "./inventory-row";
import { lastPageIndex, showsBottomPager } from "./pagination";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useInventoryData } from "./use-inventory-data";
import { InventoryAppliedFilters } from "./InventoryAppliedFilters";
import { InventoryEmptyState } from "./InventoryEmptyState";
import { CLEARED_INVENTORY_FILTERS } from "./inventory-view";
import { INVENTORY_OUT_OF_DATE_RULE } from "./inventory-coverage";
import { ListToolbar } from "./ListToolbar";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { ErrorAlert } from "./ErrorAlert";
import "./Inventory.css";

export function Inventory({
  identity,
  viewState,
  onViewStateChange,
  onViewStateCorrect,
  onShowTransactions,
  updating = false,
}: CorrectableViewStateProps<InventoryViewState> & {
  identity: Identity;
  onShowTransactions: (sku: string) => void;
  updating?: boolean;
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
  // Corrections to the loaded data replace the history entry, so Back still leaves the link.
  useEffect(() => {
    if (finalPage !== null && viewState.pageIndex > finalPage)
      onViewStateCorrect((current) => ({ ...current, pageIndex: finalPage, selectedRowId: null }));
  }, [finalPage, viewState.pageIndex, onViewStateCorrect]);
  const selectedRow = rows.find((row) => inventoryRowId(row) === selectedRowId) ?? null;
  useEffect(() => {
    if (selectedRowId && !query.isFetching && (denied || (query.isSuccess && !selectedRow)))
      onViewStateCorrect((current) => ({ ...current, selectedRowId: null }));
  }, [selectedRowId, query.isFetching, query.isSuccess, denied, selectedRow, onViewStateCorrect]);
  const filtered = Boolean(
    viewState.search ||
    viewState.marketplaces.length ||
    companyIds.length ||
    viewState.skus.length ||
    viewState.healthStatuses.length ||
    viewState.recommendations.length,
  );
  // One alert: the inventory read first, else the availability check behind an empty list.
  const loadError = query.isError
    ? {
        title: "Could not load inventory",
        detail: `${loadErrorDetail(query.error)}${query.data && !denied ? " Showing previously loaded values." : ""}`,
      }
    : captures.isError && rows.length === 0
      ? { title: "Could not load inventory availability", detail: loadErrorDetail(captures.error) }
      : null;
  function retryLoad() {
    if (query.isError) void query.refetch();
    if (captures.isError) void captures.refetch();
  }
  const changePage = (pageIndex: number) => {
    onViewStateChange((current) => ({ ...current, pageIndex, selectedRowId: null }));
  };
  function showControls() {
    revealSection(pageStart.current);
  }
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
    isBusy: query.isPending || query.isFetching,
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
        status={
          query.isPending || (rows.length === 0 && captures.isPending)
            ? "loading"
            : query.isFetching || captures.isFetching || updating
              ? "updating"
              : null
        }
        help={
          <>
            <p>Latest imported stock and replenishment recommendations for each marketplace.</p>
            <ul>
              <li>Select a SKU to view its transactions, or a row to open inventory details.</li>
              <li>
                Use column headings to filter or sort. Replenishment actions have the highest
                priority.
              </li>
              <li>Each row shows its stock date and age. {INVENTORY_OUT_OF_DATE_RULE}</li>
              <li>
                Sales are historical; quantities are estimates. A dash means unavailable, while zero
                is a reported value.
              </li>
            </ul>
          </>
        }
      />
      {loadError ? (
        <ErrorAlert
          {...loadError}
          retrying={query.isFetching || captures.isFetching}
          onRetry={retryLoad}
        />
      ) : null}
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
        message={totalCount === null ? "" : undefined}
      />
      <InventoryTable
        appliedFilters={
          <InventoryAppliedFilters
            state={{ ...viewState, companyIds }}
            companyNames={companyNames}
            onChange={changeFilters}
            focusTarget={searchInput}
          />
        }
        emptyState={
          !query.isPending && !query.isError && captures.isSuccess && rows.length === 0 ? (
            <InventoryEmptyState
              captures={captures.data}
              marketplaces={viewState.marketplaces}
              hasItems={hasItems}
              member={identity.account.access_role === "member"}
              focusTarget={searchInput}
              onReset={
                filtered
                  ? () => {
                      changeFilters({ search: "", ...CLEARED_INVENTORY_FILTERS });
                    }
                  : undefined
              }
            />
          ) : undefined
        }
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
      {showsBottomPager(rows.length, viewState.pageIndex) ? (
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
          onPageChange={(pageIndex) => {
            changePage(pageIndex);
            showControls();
          }}
          onBackToFilters={showControls}
        />
      ) : null}
      <InventoryDetail
        row={selectedRow}
        administrator={administrator}
        onClose={() => {
          selectRow(null);
        }}
        onShowTransactions={showTransactions}
        now={now}
      />
    </div>
  );
}
