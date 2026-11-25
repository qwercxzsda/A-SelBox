import { useRef } from "react";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationGroup } from "./SkuConfigurationGroup";
import { ListToolbar } from "./ListToolbar";
import { AppliedFeeFilters, FeeFilterHeader } from "./FeeListFilters";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { CLEARED_FEE_FILTERS, feeMarketplaces, filterFeeList } from "./fee-filters";
import { paginateLocalList } from "./local-list";
import type { SkuFormIssue } from "./sku-configuration-form";
import { companyLabel } from "./view-model";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { showsBottomPager } from "./pagination";
import { EmptyState } from "./EmptyState";
import { TableColumnLabel } from "./TableColumnLabel";
import { FEE_PERIOD_FROM_LABEL, FEE_PERIOD_UNTIL_LABEL } from "./fee-period-labels";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import "./SkuConfigurationList.css";

export function SkuConfigurationList({
  items,
  loaded,
  companies,
  issuesBySku,
  administrator,
  onSelect,
  viewState,
  onViewStateChange,
}: {
  items: SkuConfigurationItem[];
  /** False until the first list arrives: no counts and no empty state yet. */
  loaded: boolean;
  companies: Map<string, string>;
  issuesBySku: Map<string, SkuFormIssue[]>;
  administrator: boolean;
  onSelect: (sku: string) => void;
} & ViewStateProps<FeeViewState>) {
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const { search, pageSize, selectedSku, expandedSkus } = viewState;
  const { filtered, filters, statusOptions, statusesFor, hasFilters } = filterFeeList(
    items,
    viewState,
    { administrator, companies, issuesBySku },
  );
  const pagination = paginateLocalList(filtered, viewState.pageIndex, pageSize);
  const canPrevious = loaded && pagination.pageIndex > 0;
  const canNext = loaded && pagination.pageIndex < pagination.pageCount - 1;
  const skuOptions = items.map((item) => item.sku);
  const header = (field: "skus" | "companyIds" | "marketplaces" | "statuses") => (
    <FeeFilterHeader
      field={field}
      filters={filters}
      companies={companies}
      skus={skuOptions}
      statusOptions={statusOptions}
      onChange={changeFilters}
    />
  );
  const columns: RecordColumn[] = [
    { key: "sku", label: "SKU", width: 220, header: header("skus") },
    ...(administrator
      ? [{ key: "company", label: "Company", width: 180, header: header("companyIds") }]
      : []),
    { key: "periods", label: "Fee periods", width: 150 },
    {
      key: "marketplaces",
      label: "Marketplace",
      width: 165,
      header: header("marketplaces"),
    },
    { key: "rate", label: "Fee rate", align: "right", width: 100 },
    {
      key: "from",
      label: FEE_PERIOD_FROM_LABEL,
      width: 135,
      header: <TableColumnLabel label={FEE_PERIOD_FROM_LABEL} />,
    },
    {
      key: "until",
      label: FEE_PERIOD_UNTIL_LABEL,
      width: 135,
      header: <TableColumnLabel label={FEE_PERIOD_UNTIL_LABEL} />,
    },
    { key: "status", label: "Status", width: 145, header: header("statuses") },
  ];
  function change(patch: Partial<FeeViewState>) {
    onViewStateChange((current) => ({ ...current, ...patch }));
  }
  function changeFilters(patch: Partial<FeeViewState>) {
    change({ ...patch, pageIndex: 0 });
  }
  function showControls() {
    revealSection(controlsRef.current);
  }
  return (
    <>
      <ListToolbar
        controlsRef={controlsRef}
        label="Fee list controls"
        search={{
          inputRef: searchInput,
          ariaLabel: "Search SKUs",
          placeholder: administrator ? "SKU or company" : "SKU",
          value: search,
          onChange: (search) => {
            change({ search, pageIndex: 0 });
          },
        }}
        pageSize={pageSize}
        onPageSizeChange={(pageSize) => {
          change({ pageSize, pageIndex: 0 });
        }}
        pagination={{
          pageIndex: pagination.pageIndex,
          pageCount: loaded ? pagination.pageCount : null,
          canPrevious,
          canNext,
          onPrevious: () => {
            change({ pageIndex: pagination.pageIndex - 1 });
          },
          onNext: () => {
            change({ pageIndex: pagination.pageIndex + 1 });
          },
          onPageChange: (pageIndex) => {
            change({ pageIndex });
          },
        }}
        rowCount={pagination.visibleItems.length}
        totalCount={pagination.totalCount}
        items="SKUs"
        message={loaded ? undefined : ""}
      />
      <RecordTable
        label="Current fee configurations"
        grouped
        className="fee-configurations-table grouped-table"
        columns={columns}
        minWidth={administrator ? 1230 : 1050}
        appliedFilters={
          <AppliedFeeFilters
            filters={filters}
            companies={companies}
            onChange={changeFilters}
            focusTarget={searchInput}
          />
        }
        emptyState={
          loaded && pagination.visibleItems.length === 0 ? (
            <EmptyState
              title={
                hasFilters
                  ? "No matching SKUs"
                  : administrator
                    ? "No SKUs yet"
                    : "No SKUs for your company yet"
              }
              action={
                hasFilters
                  ? {
                      label: "Reset search and filters",
                      focusTarget: searchInput,
                      onClick: () => {
                        changeFilters({ search: "", ...CLEARED_FEE_FILTERS });
                      },
                    }
                  : undefined
              }
            />
          ) : undefined
        }
      >
        {pagination.visibleItems.map((item) => (
          <SkuConfigurationGroup
            key={item.sku}
            item={item}
            companyName={companyLabel(item.company_id, companies)}
            marketplaces={feeMarketplaces(item)}
            statuses={statusesFor(item.sku)}
            administrator={administrator}
            selected={selectedSku === item.sku}
            expanded={expandedSkus.includes(item.sku)}
            onToggle={(sku) => {
              onViewStateChange((current) => ({
                ...current,
                expandedSkus: current.expandedSkus.includes(sku)
                  ? current.expandedSkus.filter((value) => value !== sku)
                  : [...current.expandedSkus, sku],
              }));
            }}
            onSelect={onSelect}
          />
        ))}
      </RecordTable>
      {showsBottomPager(pagination.visibleItems.length, pagination.pageIndex) ? (
        <ListPageNavigation
          labels={{
            navigation: "SKU list navigation at bottom",
            items: "SKUs",
            back: "Back to SKU filters",
          }}
          pageIndex={pagination.pageIndex}
          pageCount={pagination.pageCount}
          canPrevious={canPrevious}
          canNext={canNext}
          onBackToFilters={showControls}
          onPageChange={(pageIndex) => {
            change({ pageIndex });
            showControls();
          }}
        />
      ) : null}
    </>
  );
}
