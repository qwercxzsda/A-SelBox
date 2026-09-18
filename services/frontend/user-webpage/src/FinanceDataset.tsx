import {
  Alert,
  Button,
  CloseButton,
  Group,
  NativeSelect,
  Paper,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { type DatasetKey, DATASET_CONFIG } from "./api";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import { DATASET_PRESENTATION, PAGE_SIZES, displayColumns, getErrorMessage } from "./view-model";
import type { WorkspaceProps } from "./FinanceWorkspace";
import { PaginationBar } from "./PaginationBar";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";

export function FinanceDataset({
  identity,
  dataset,
  onRetry,
  isUpdating,
  viewState,
  onViewStateChange,
}: WorkspaceProps & { dataset: DatasetKey } & ViewStateProps<DatasetViewState>) {
  const {
    table,
    query,
    totalCount,
    search,
    changeSearch,
    filters,
    changeFilters,
    companies,
    skuNames,
  } = useFinanceTable(identity, dataset, viewState, onViewStateChange);
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows;
  const presentation = DATASET_PRESENTATION[dataset];
  const pageCount = totalCount === null ? null : table.getPageCount();
  const isBusy = query.isFetching || isUpdating;
  const selectedRow = table.getSelectedRowModel().rows[0]?.original ?? null;
  const filterCount = activeFilterCount(filters);
  const hasFilters = filterCount > 0;
  const hasRefinements = hasFilters || search.trim().length > 0;
  const columns = displayColumns(dataset, identity.account.access_role === "operator");
  const sort = viewState.sorting[0];
  return (
    <>
      <Text mb="md" role="note" c="dimmed" size="sm">
        {presentation.description}
      </Text>
      {query.error ? (
        <Alert color="red" role="alert" mb="md">
          {getErrorMessage(query.error)}
          <Button variant="subtle" disabled={isBusy} onClick={() => void onRetry()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      <Group className="table-toolbar" justify="space-between" align="end">
        <Group align="end" className="table-toolbar-fields">
          <TextInput
            className="search-field"
            label="Search"
            type="search"
            value={search}
            placeholder={presentation.searchPlaceholder}
            disabled={DATASET_CONFIG[dataset].searchColumns.length === 0}
            rightSectionPointerEvents="auto"
            rightSection={
              search ? (
                <CloseButton
                  aria-label="Clear search"
                  onClick={() => {
                    changeSearch("");
                  }}
                />
              ) : undefined
            }
            onChange={(event) => {
              changeSearch(event.currentTarget.value);
            }}
          />
          <NativeSelect
            label="Rows"
            value={pageSize}
            data={PAGE_SIZES.map(String)}
            onChange={(event) => {
              table.setPagination({ pageIndex: 0, pageSize: Number(event.currentTarget.value) });
            }}
          />
        </Group>
      </Group>
      {hasFilters ? (
        <Group gap="xs" mb="xs">
          <Text size="sm" c="dimmed">
            {filterCount} {filterCount === 1 ? "filter" : "filters"} applied
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              changeFilters(normalizeDatasetFilters());
            }}
          >
            Clear filters
          </Button>
        </Group>
      ) : null}
      <PaginationBar
        pageIndex={pageIndex}
        pageCount={pageCount}
        canPrevious={table.getCanPreviousPage()}
        canNext={totalCount === null ? rows.length === pageSize : table.getCanNextPage()}
        isBusy={isBusy}
        onPrevious={() => {
          table.previousPage();
        }}
        onNext={() => {
          table.nextPage();
        }}
        onPageChange={(index) => {
          table.setPageIndex(index);
        }}
        summary={
          query.isPending
            ? `Loading page ${String(pageIndex + 1)}…`
            : `${String(rows.length === 0 ? 0 : pageIndex * pageSize + 1)}–${String(rows.length === 0 ? 0 : pageIndex * pageSize + rows.length)} of ${totalCount?.toLocaleString("en-US") ?? "—"} rows`
        }
      />
      <Text size="xs" c="dimmed" mb="xs">
        Select a row or press Enter to view its details.
      </Text>
      <Paper withBorder className="table-card" aria-busy={isBusy}>
        <div
          className="table-horizontal-scroll"
          role="region"
          aria-label="Financial table"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
          tabIndex={0}
        >
          <Table
            highlightOnHover
            fz="sm"
            aria-label="Financial records"
            miw={Math.max(900, table.getAllLeafColumns().length * 120)}
          >
            <Table.Thead>
              {table.getHeaderGroups().map((group) => (
                <Table.Tr key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const column = columns.find(
                      (definition) => definition.key === header.column.id,
                    );
                    return (
                      <Table.Th
                        key={header.id}
                        className={
                          header.column.columnDef.meta?.align === "right" ? "numeric" : undefined
                        }
                        scope="col"
                        aria-sort={
                          header.column.getCanSort()
                            ? sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                      >
                        {column ? (
                          <FinanceColumnHeader
                            column={column}
                            dataset={dataset}
                            identity={identity}
                            filters={filters}
                            onFiltersChange={changeFilters}
                            sort={{ column: sort.id, direction: sort.desc ? "desc" : "asc" }}
                            onSortChange={({ column: id, direction }) => {
                              table.setSorting([{ id, desc: direction === "desc" }]);
                            }}
                          />
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr
                  key={row.id}
                  tabIndex={0}
                  aria-selected={row.getIsSelected()}
                  aria-haspopup="dialog"
                  className={row.getIsSelected() ? "inspectable-row selected" : "inspectable-row"}
                  onClick={(event) => {
                    if (window.getSelection()?.type === "Range") return;
                    event.currentTarget.focus();
                    row.toggleSelected(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      row.toggleSelected(true);
                    }
                  }}
                >
                  {row.getAllCells().map((cell) => (
                    <Table.Td
                      key={cell.id}
                      className={
                        cell.column.columnDef.meta?.align === "right" ? "numeric" : undefined
                      }
                    >
                      <table.FlexRender cell={cell} />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {query.isPending ? (
            <div className="loading-state" role="status">
              Loading rows…
            </div>
          ) : null}
          {!query.isPending && !query.isError && rows.length === 0 ? (
            <div className="empty-state">
              <Text fw={600}>
                {hasRefinements ? "No matching records" : presentation.emptyMessage}
              </Text>
              {hasRefinements ? (
                <Text c="dimmed" size="sm">
                  {hasFilters
                    ? "Adjust your selections or use Clear filters to see more records."
                    : "Try a different search or use Clear search to see all records."}
                </Text>
              ) : null}
            </div>
          ) : null}
        </div>
      </Paper>
      <RowDetail
        isAdministrator={identity.account.access_role === "operator"}
        companies={companies}
        dataset={dataset}
        row={selectedRow}
        skuNames={skuNames}
        onClose={() => {
          table.resetRowSelection();
        }}
      />
    </>
  );
}
