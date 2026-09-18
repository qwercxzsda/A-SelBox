import { useEffect, useState } from "react";
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
import type { CanonicalRow, DatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { lastPageIndex } from "./pagination";
import { displayColumns, rowId } from "./view-model";
import { useDatasetQuery } from "./use-dataset-query";
import type { Identity } from "./use-auth";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";

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
  dataset: DatasetKey,
  viewState: DatasetViewState,
  onViewStateChange: ViewStateProps<DatasetViewState>["onViewStateChange"],
) {
  const { pagination, sorting, search } = viewState;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [debouncedSearch] = useDebouncedValue(search.trim(), 250);
  const sort = sorting[0];
  const query = useDatasetQuery(identity, {
    dataset,
    ...pagination,
    search: debouncedSearch,
    sort: { column: sort.id, direction: sort.desc ? "desc" : "asc" },
  });
  const rows = query.isError ? EMPTY_ROWS : (query.data?.rows ?? EMPTY_ROWS);
  const totalCount = query.isError ? null : (query.data?.totalCount ?? null);
  const companies = new Map(identity.companies.map((company) => [company.id, company.name]));
  const skuNames = new Map(
    identity.assignments.map((assignment) => [assignment.id, assignment.sku]),
  );
  const columns: ColumnDef<typeof features, CanonicalRow>[] = displayColumns(
    dataset,
    identity.account.access_role === "operator",
  ).map((column) => ({
    id: column.key,
    accessorFn: (row) => row[column.key],
    header: column.label,
    enableSorting: Boolean(column.sortable),
    meta: { align: column.align },
    cell: ({ row }) => (
      <TableCellValue
        column={column}
        row={row.original}
        companies={companies}
        skuNames={skuNames}
      />
    ),
  }));
  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: rowId,
    state: { pagination, sorting, rowSelection },
    manualSorting: true,
    manualPagination: true,
    pageCount: totalCount === null ? -1 : Math.max(1, Math.ceil(totalCount / pagination.pageSize)),
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
    enableMultiRowSelection: false,
    onPaginationChange: (update) => {
      setRowSelection({});
      onViewStateChange((current) => ({
        ...current,
        pagination: typeof update === "function" ? update(current.pagination) : update,
      }));
    },
    onSortingChange: (update) => {
      setRowSelection({});
      onViewStateChange((current) => ({
        ...current,
        pagination: { ...current.pagination, pageIndex: 0 },
        sorting: typeof update === "function" ? update(current.sorting) : update,
      }));
    },
    onRowSelectionChange: setRowSelection,
  });
  // Synchronize server-side shrinkage (including HTTP 416) after the query updates.
  const finalPage = totalCount === null ? null : lastPageIndex(totalCount, pagination.pageSize);
  useEffect(() => {
    if (finalPage !== null && pagination.pageIndex > finalPage) table.setPageIndex(finalPage);
  }, [finalPage, pagination.pageIndex, table]);

  function changeSearch(value: string) {
    setRowSelection({});
    onViewStateChange((current) => ({
      ...current,
      search: value,
      pagination: { ...current.pagination, pageIndex: 0 },
    }));
  }
  return { table, query, totalCount, search, changeSearch, companies, skuNames };
}
