import { useRef } from "react";
import { Button, Stack, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationGroup } from "./SkuConfigurationGroup";
import { ListToolbar } from "./ListToolbar";
import { AppliedFeeFilters, FeeFilterHeader } from "./FeeListFilters";
import { FEE_STATUSES, type FeeStatus } from "./fee-status";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { filterFeeSkus, paginateFeeSkus } from "./fee-skus";
import type { SkuFormIssue } from "./sku-configuration-form";
import { companyLabel } from "./view-model";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { TableColumnLabel } from "./TableColumnLabel";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import "./SkuConfigurationList.css";

function marketplacesFor(item: SkuConfigurationItem) {
  return [
    ...new Set(
      [
        ...item.periods.map((period) => period.marketplace_name),
        ...item.requirements.map((requirement) => requirement.marketplace_name),
      ].filter(Boolean),
    ),
  ].sort();
}

export function SkuConfigurationList({
  items,
  companies,
  issuesBySku,
  administrator,
  onSelect,
  viewState,
  onViewStateChange,
}: {
  items: SkuConfigurationItem[];
  companies: Map<string, string>;
  issuesBySku: Map<string, SkuFormIssue[]>;
  administrator: boolean;
  onSelect: (sku: string) => void;
} & ViewStateProps<FeeViewState>) {
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const { search, pageSize, selectedSku, expandedSkus, drafts } = viewState;
  const draftSkus = new Set(drafts.map((draft) => draft.sku));
  const unfinishedSkus = new Set(
    viewState.editorDrafts.filter((editor) => !editor.isNew).map((editor) => editor.sku),
  );
  const companyIds = administrator ? viewState.companyIds : [];
  const statusOptions: readonly FeeStatus[] = administrator
    ? FEE_STATUSES
    : ["needs-setup", "saved"];
  const selectedStatuses = viewState.statuses.filter((status) => statusOptions.includes(status));
  const selectedSkus = new Set(viewState.skus);
  const statusesFor = (sku: string): FeeStatus[] => {
    const statuses: FeeStatus[] = [];
    if (issuesBySku.has(sku)) statuses.push("needs-setup");
    if (administrator && draftSkus.has(sku)) statuses.push("draft");
    if (administrator && unfinishedSkus.has(sku)) statuses.push("unfinished");
    return statuses.length ? statuses : ["saved"];
  };
  const filtered = filterFeeSkus(items, search, administrator ? companies : undefined).filter(
    (item) =>
      (!selectedSkus.size || selectedSkus.has(item.sku)) &&
      (!companyIds.length || companyIds.includes(item.company_id)) &&
      (!viewState.marketplaces.length ||
        marketplacesFor(item).some((market) => viewState.marketplaces.includes(market))) &&
      (!selectedStatuses.length ||
        statusesFor(item.sku).some((status) => selectedStatuses.includes(status))),
  );
  const pagination = paginateFeeSkus(filtered, viewState.pageIndex, pageSize);
  const canPrevious = pagination.pageIndex > 0;
  const canNext = pagination.pageIndex < pagination.pageCount - 1;
  const filters = {
    skus: viewState.skus,
    companyIds,
    marketplaces: viewState.marketplaces,
    statuses: selectedStatuses,
  };
  const marketplaceOptions = [...new Set(items.flatMap(marketplacesFor))].sort();
  const skuOptions = items.map((item) => item.sku);
  const header = (field: "skus" | "companyIds" | "marketplaces" | "statuses") => (
    <FeeFilterHeader
      field={field}
      filters={filters}
      companies={companies}
      skus={skuOptions}
      marketplaces={marketplaceOptions}
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
    { key: "from", label: "Effective from", width: 135 },
    {
      key: "until",
      label: "Effective until",
      width: 135,
      header: <TableColumnLabel label="Effective until (exclusive)" />,
    },
    { key: "status", label: "Status", width: 145, header: header("statuses") },
  ];
  const hasFilters = Boolean(
    search ||
    viewState.skus.length ||
    companyIds.length ||
    viewState.marketplaces.length ||
    selectedStatuses.length,
  );
  function change(patch: Partial<FeeViewState>) {
    onViewStateChange((current) => ({ ...current, ...patch }));
  }
  function changeFilters(patch: Partial<FeeViewState>) {
    change({ ...patch, pageIndex: 0 });
  }
  function clearFilters() {
    changeFilters({ search: "", skus: [], companyIds: [], marketplaces: [], statuses: [] });
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
          pageCount: pagination.pageCount,
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
        rowCount={pagination.visibleSkus.length}
        totalCount={pagination.totalCount}
        items="SKUs"
      />
      <AppliedFeeFilters
        filters={filters}
        companies={companies}
        onChange={changeFilters}
        focusTarget={searchInput}
      />
      <RecordTable
        label="Current fee configurations"
        grouped
        className="fee-configurations-table month-grouped-table"
        columns={columns}
        minWidth={administrator ? 1230 : 1050}
        emptyState={
          pagination.visibleSkus.length === 0 ? (
            <Stack align="center" gap="sm">
              <Text c="dimmed">
                {hasFilters
                  ? "No SKUs match these filters."
                  : administrator
                    ? "No SKUs are available yet."
                    : "No SKUs are assigned to your company."}
              </Text>
              {hasFilters ? (
                <Button
                  variant="subtle"
                  onClick={(event) => {
                    if (event.detail === 0) searchInput.current?.focus();
                    clearFilters();
                  }}
                >
                  Clear search and filters
                </Button>
              ) : null}
            </Stack>
          ) : undefined
        }
      >
        {pagination.visibleSkus.map((item) => (
          <SkuConfigurationGroup
            key={item.sku}
            item={item}
            companyName={companyLabel(item.company_id, companies)}
            marketplaces={marketplacesFor(item)}
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
      {pagination.visibleSkus.length > 10 || pagination.pageIndex > 0 ? (
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
