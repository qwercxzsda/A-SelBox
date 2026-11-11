import { useRef } from "react";
import { Button, Stack, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationRow } from "./SkuConfigurationRow";
import { ListToolbar } from "./ListToolbar";
import { AppliedFeeFilters, FeeFilterHeader } from "./FeeListFilters";
import { FEE_STATUSES, type FeeStatus } from "./fee-status";
import { ExpandableTable, type ExpandableColumn } from "./ExpandableTable";
import { filterFeeSkus, paginateFeeSkus } from "./fee-skus";
import type { SkuFormIssue } from "./sku-configuration-form";
import { companyLabel } from "./view-model";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
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
  isSaving,
  onEdit,
  onShowTransactions,
  viewState,
  onViewStateChange,
}: {
  items: SkuConfigurationItem[];
  companies: Map<string, string>;
  issuesBySku: Map<string, SkuFormIssue[]>;
  administrator: boolean;
  isSaving: boolean;
  onEdit: (sku: string) => void;
  onShowTransactions: (sku: string) => void;
} & ViewStateProps<FeeViewState>) {
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const { search, pageSize, expanded, drafts } = viewState;
  const draftSkus = new Set(drafts.map((draft) => draft.sku));
  const unfinishedSkus = new Set(
    viewState.editorDrafts.filter((editor) => !editor.isNew).map((editor) => editor.sku),
  );
  const companyIds = administrator ? viewState.companyIds : [];
  const statusOptions: readonly FeeStatus[] = administrator
    ? FEE_STATUSES
    : ["needs-setup", "saved"];
  const selectedStatuses = viewState.statuses.filter((status) => statusOptions.includes(status));
  const statusesFor = (sku: string): FeeStatus[] => {
    const statuses: FeeStatus[] = [];
    if (issuesBySku.has(sku)) statuses.push("needs-setup");
    if (administrator && draftSkus.has(sku)) statuses.push("draft");
    if (administrator && unfinishedSkus.has(sku)) statuses.push("unfinished");
    return statuses.length ? statuses : ["saved"];
  };
  const filtered = filterFeeSkus(items, search, administrator ? companies : undefined).filter(
    (item) =>
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
    companyIds,
    marketplaces: viewState.marketplaces,
    statuses: selectedStatuses,
  };
  const marketplaceOptions = [...new Set(items.flatMap(marketplacesFor))].sort();
  const header = (field: "companyIds" | "marketplaces" | "statuses") => (
    <FeeFilterHeader
      field={field}
      filters={filters}
      companies={companies}
      marketplaces={marketplaceOptions}
      statusOptions={statusOptions}
      onChange={changeFilters}
    />
  );
  const columns: ExpandableColumn[] = [
    { key: "sku", label: "SKU" },
    ...(administrator
      ? [{ key: "company", label: "Company", width: "21%", header: header("companyIds") }]
      : []),
    {
      key: "marketplaces",
      label: "Marketplaces",
      width: administrator ? "19%" : "25%",
      header: header("marketplaces"),
    },
    { key: "periods", label: "Fee periods", align: "right", width: 90 },
    { key: "status", label: "Status", width: 145, header: header("statuses") },
  ];
  const hasFilters = Boolean(
    search || companyIds.length || viewState.marketplaces.length || selectedStatuses.length,
  );
  function change(patch: Partial<FeeViewState>) {
    onViewStateChange((current) => ({ ...current, ...patch }));
  }
  function changeFilters(patch: Partial<FeeViewState>) {
    change({ ...patch, pageIndex: 0 });
  }
  function clearFilters() {
    changeFilters({ search: "", companyIds: [], marketplaces: [], statuses: [] });
  }
  function showControls() {
    revealSection(controlsRef.current);
  }
  function toggleSku(sku: string) {
    onViewStateChange((current) => ({
      ...current,
      expanded: current.expanded.includes(sku)
        ? current.expanded.filter((value) => value !== sku)
        : [...current.expanded, sku],
    }));
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
      <ExpandableTable
        label="Current fee configurations"
        columns={columns}
        minWidth={administrator ? 900 : 700}
        actionsWidth={administrator ? 96 : undefined}
        onCollapseAll={
          expanded.length
            ? () => {
                change({ expanded: [] });
              }
            : undefined
        }
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
          <SkuConfigurationRow
            key={item.sku}
            item={item}
            companyName={companyLabel(item.company_id, companies)}
            marketplaces={marketplacesFor(item)}
            statuses={statusesFor(item.sku)}
            issues={issuesBySku.get(item.sku) ?? []}
            administrator={administrator}
            isSaving={isSaving}
            expanded={expanded.includes(item.sku)}
            columnCount={columns.length + 1 + Number(administrator)}
            onToggle={toggleSku}
            onEdit={onEdit}
            onShowTransactions={onShowTransactions}
            onDiscardDraft={(sku) => {
              onViewStateChange((current) => ({
                ...current,
                drafts: current.drafts.filter((draft) => draft.sku !== sku),
              }));
            }}
          />
        ))}
      </ExpandableTable>
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
