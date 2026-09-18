import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Group,
  NativeSelect,
  Paper,
  Table,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { type DatasetKey, DATASET_CONFIG } from "./api";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import {
  companyLabel,
  DATASET_PRESENTATION,
  PAGE_SIZES,
  TABLE_COLUMNS,
  getErrorMessage,
} from "./view-model";
import type { WorkspaceProps } from "./FinanceWorkspace";

export function FinanceDataset({
  identity,
  dataset,
  onRefreshIdentity,
}: WorkspaceProps & { dataset: DatasetKey }) {
  const { table, query, totalCount, search, changeSearch, companies, skuNames } = useFinanceTable(
    identity,
    dataset,
  );
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows;
  const presentation = DATASET_PRESENTATION[dataset];
  const pageCount = totalCount === null ? null : table.getPageCount();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isBusy = query.isFetching || isRefreshing;
  const selectedRow = table.getSelectedRowModel().rows[0]?.original ?? null;
  async function refresh() {
    table.resetRowSelection();
    setIsRefreshing(true);
    try {
      if (await onRefreshIdentity()) {
        // Invalidate every cached page so shrinking datasets cannot revive an old page.
        await queryClient.invalidateQueries({ queryKey: ["dataset"] });
      }
    } finally {
      setIsRefreshing(false);
    }
  }
  return (
    <>
      <Alert mb="md" role="note">
        {presentation.description}
      </Alert>
      {query.error ? (
        <Alert color="red" role="alert" mb="md">
          {getErrorMessage(query.error)}
        </Alert>
      ) : null}
      <Paper component="section" withBorder className="summary-grid" aria-live="polite">
        {[
          ["Matching rows", totalCount?.toLocaleString("en-US") ?? "—"],
          ["View", presentation.label],
          [
            "Access",
            identity.account.access_role === "operator"
              ? "All companies"
              : companyLabel(identity.account.company_id, companies),
          ],
          ["Page", `${String(pageIndex + 1)} / ${pageCount === null ? "—" : String(pageCount)}`],
        ].map(([label, value]) => (
          <div className="summary-item" key={label}>
            <span className="summary-label">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </Paper>
      <Group className="table-toolbar" justify="space-between" align="end">
        <Group align="end" className="table-toolbar-fields">
          <TextInput
            className="search-field"
            label="Search"
            type="search"
            value={search}
            placeholder={presentation.searchPlaceholder}
            disabled={DATASET_CONFIG[dataset].searchColumns.length === 0}
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
        <Button variant="default" disabled={isBusy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </Group>
      <Paper withBorder className="table-card" aria-busy={isBusy}>
        <Table.ScrollContainer minWidth={Math.max(980, TABLE_COLUMNS[dataset].length * 132)}>
          <Table highlightOnHover fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((group) => (
                <Table.Tr key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
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
                        {header.column.getCanSort() ? (
                          <UnstyledButton
                            className="sort-button"
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            <span className="sort-indicator" aria-hidden="true">
                              {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
                            </span>
                          </UnstyledButton>
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
        </Table.ScrollContainer>
        {query.isPending ? (
          <div className="loading-state" role="status">
            Loading rows…
          </div>
        ) : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <div className="empty-state">{presentation.emptyMessage}</div>
        ) : null}
      </Paper>
      <Group className="pagination-bar" justify="space-between">
        <span>
          {rows.length === 0 ? 0 : pageIndex * pageSize + 1}-{pageIndex * pageSize + rows.length} of{" "}
          {totalCount?.toLocaleString("en-US") ?? "—"}
        </span>
        <Group>
          <Button
            variant="default"
            disabled={!table.getCanPreviousPage() || isBusy}
            onClick={() => {
              table.previousPage();
            }}
          >
            Previous
          </Button>
          <Button
            variant="default"
            disabled={
              isBusy || (totalCount === null ? rows.length < pageSize : !table.getCanNextPage())
            }
            onClick={() => {
              table.nextPage();
            }}
          >
            Next
          </Button>
        </Group>
      </Group>
      <RowDetail
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
