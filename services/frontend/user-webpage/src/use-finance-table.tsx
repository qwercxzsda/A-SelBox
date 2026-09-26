import { useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import type { CanonicalRow, TableDatasetKey } from "./api";
import type { DatasetFilters } from "./api/types";
import { TableCellValue } from "./Cell";
import { lastPageIndex } from "./pagination";
import { displayColumns, rowId } from "./view-model";
import { useDatasetQuery } from "./use-dataset-query";
import type { Identity } from "./auth-session";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";
import { normalizeDatasetFilters } from "./dataset-filters";

const columnMeta: { align?: "right" } = {};
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnMeta,
});
const EMPTY_ROWS: CanonicalRow[] = [];

export function useFinanceTable(
  identity: Identity,
  dataset: TableDatasetKey,
  viewState: DatasetViewState,
  onViewStateChange: ViewStateProps<DatasetViewState>["onViewStateChange"],
) {
  const { pagination, sorting, search } = viewState;
  const filters = useMemo(() => normalizeDatasetFilters(viewState.filters), [viewState.filters]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [debouncedSearch] = useDebouncedValue(search.trim(), 250);
  const sort = sorting[0];
  const query = useDatasetQuery(identity, {
    dataset,
    ...pagination,
    search: debouncedSearch,
    filters,
    sort: { column: sort.id, direction: sort.desc ? "desc" : "asc" },
  });
  const rows = query.isError ? EMPTY_ROWS : (query.data?.rows ?? EMPTY_ROWS);
  const totalCount = query.isError ? null : query.totalCount;
  const finalPage = totalCount === null ? null : lastPageIndex(totalCount, pagination.pageSize);
  const companies = useMemo(
    () => new Map(identity.companies.map((company) => [company.id, company.name])),
    [identity.companies],
  );
  function updateView(update: (current: DatasetViewState) => DatasetViewState) {
    setRowSelection({});
    onViewStateChange(update);
  }
  const isAdministrator = identity.account.access_role === "operator";
  const columns = useMemo<ColumnDef<typeof features, CanonicalRow>[]>(
    () =>
      displayColumns(dataset, isAdministrator).map((column) => ({
        id: column.key,
        accessorFn: (row) => row[column.key],
        header: column.label,
        enableSorting: Boolean(column.sortable),
        meta: { align: column.align },
        cell: ({ row }) => (
          <TableCellValue column={column} row={row.original} companies={companies} />
        ),
      })),
    [dataset, isAdministrator, companies],
  );
  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: rowId,
    state: { pagination, sorting, rowSelection },
    manualSorting: true,
    manualPagination: true,
    pageCount: finalPage === null ? -1 : finalPage + 1,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
    enableMultiRowSelection: false,
    onPaginationChange: (update) => {
      updateView((current) => ({
        ...current,
        pagination: typeof update === "function" ? update(current.pagination) : update,
      }));
    },
    onSortingChange: (update) => {
      updateView((current) => ({
        ...current,
        pagination: { ...current.pagination, pageIndex: 0 },
        sorting: typeof update === "function" ? update(current.sorting) : update,
      }));
    },
    onRowSelectionChange: setRowSelection,
  });
  // Synchronize server-side shrinkage (including HTTP 416) after the query updates.
  useEffect(() => {
    if (finalPage !== null && pagination.pageIndex > finalPage) table.setPageIndex(finalPage);
  }, [finalPage, pagination.pageIndex, table]);

  function changeSearch(value: string) {
    updateView((current) => ({
      ...current,
      search: value,
      pagination: { ...current.pagination, pageIndex: 0 },
    }));
  }
  function changeFilters(patch: Partial<DatasetFilters>) {
    updateView((current) => ({
      ...current,
      filters: normalizeDatasetFilters({ ...current.filters, ...patch }),
      pagination: { ...current.pagination, pageIndex: 0 },
    }));
  }
  return {
    table,
    query,
    totalCount,
    search,
    changeSearch,
    filters,
    changeFilters,
    companies,
  };
}
