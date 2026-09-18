import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { DATASET_CONFIG, type CanonicalRow, type DatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { lastPageIndex } from "./pagination";
import { TABLE_COLUMNS, PAGE_SIZES, rowId } from "./view-model";
import { useDatasetQuery } from "./use-dataset-query";
import type { Identity } from "./use-auth";

const columnMeta: { align?: "right" } = {};
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnMeta,
});
const EMPTY_ROWS: CanonicalRow[] = [];

export function useFinanceTable(identity: Identity, dataset: DatasetKey) {
  const defaultSort = DATASET_CONFIG[dataset].defaultSort;
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: defaultSort.column, desc: defaultSort.direction === "desc" },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState("");
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
  // A live dataset can shrink while the current page is open (including HTTP 416).
  if (
    totalCount !== null &&
    pagination.pageIndex > lastPageIndex(totalCount, pagination.pageSize)
  ) {
    setPagination({ ...pagination, pageIndex: lastPageIndex(totalCount, pagination.pageSize) });
    setRowSelection({});
  }
  const companies = new Map(identity.companies.map((company) => [company.id, company.name]));
  const skuNames = new Map(
    identity.assignments.map((assignment) => [assignment.id, assignment.sku]),
  );
  const columns: ColumnDef<typeof features, CanonicalRow>[] = TABLE_COLUMNS[dataset].map(
    (column) => ({
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
    }),
  );
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
      setPagination(update);
    },
    onSortingChange: (update) => {
      setRowSelection({});
      setPagination((current) => ({ ...current, pageIndex: 0 }));
      setSorting(update);
    },
    onRowSelectionChange: setRowSelection,
  });
  function changeSearch(value: string) {
    setSearch(value);
    table.resetRowSelection();
    table.setPageIndex(0);
  }
  return { table, query, totalCount, search, changeSearch, companies, skuNames };
}
