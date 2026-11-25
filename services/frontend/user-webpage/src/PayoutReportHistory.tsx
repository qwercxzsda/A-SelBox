import { useRef } from "react";
import { Table, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";
import { pageRangeSummary } from "./pagination";
import type { ColumnDefinition } from "./table-columns";
import { rowId } from "./view-model";
import { PaginationBar } from "./PaginationBar";
import { PayoutReportRow } from "./PayoutReportRow";
import type { PayoutReportHistoryPage } from "./use-payout-report-histories";

export function PayoutReportHistory({
  page,
  scopeKey,
  label,
  columns,
  companies,
  onPageChange,
  onSelect,
  selectedRowId,
}: {
  page: PayoutReportHistoryPage;
  scopeKey: string;
  label: string;
  columns: readonly ColumnDefinition[];
  companies: Map<string, string>;
  onPageChange: (pageIndex: number) => void;
  onSelect: (row: CanonicalRow) => void;
  selectedRowId: string | null;
}) {
  const controls = useRef<HTMLDivElement>(null);
  const { query, rows, loadedCount, total, pageIndex, pageCount, showPagination, showControls } =
    page;
  function focusControls() {
    controls.current?.focus({ preventScroll: true });
  }
  /** The pager sits above the versions, so paging keeps the scroll position like list tabs. */
  function changePage(next: number) {
    focusControls();
    onPageChange(next);
  }
  return (
    <>
      {showControls ? (
        <Table.Tr className="payout-history-controls" data-scope={scopeKey}>
          <Table.Td colSpan={columns.length}>
            <div
              ref={controls}
              tabIndex={-1}
              role="group"
              aria-label={`Report versions for ${label}`}
              className="payout-history-controls-content"
            >
              {query.isError ? (
                <ErrorAlert
                  title="Could not load report versions"
                  detail={loadErrorDetail(query.error)}
                  retrying={query.isFetching}
                  onRetry={() => {
                    focusControls();
                    controls.current?.scrollIntoView({
                      block: "start",
                      inline: "start",
                      behavior: "instant",
                    });
                    void query.refetch();
                  }}
                />
              ) : query.isPending ? (
                <Text role="status" size="var(--ui-font-caption)" c="dimmed">
                  Loading report versions…
                </Text>
              ) : rows.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {pageIndex === 0 ? "No previous versions" : "No versions on this page"}
                </Text>
              ) : null}
              {showPagination ? (
                <PaginationBar
                  ariaLabel={`Report version pagination for ${label}`}
                  pageIndex={pageIndex}
                  pageCount={pageCount}
                  canPrevious={pageIndex > 0}
                  canNext={
                    pageCount === null
                      ? loadedCount === DETAIL_PAGE_SIZE
                      : pageIndex + 1 < pageCount
                  }
                  isBusy={query.isFetching}
                  onPrevious={() => {
                    changePage(pageIndex - 1);
                  }}
                  onNext={() => {
                    changePage(pageIndex + 1);
                  }}
                  onPageChange={changePage}
                  summary={
                    query.isPending
                      ? "Loading report versions…"
                      : query.isError
                        ? "Report versions unavailable"
                        : pageRangeSummary(
                            pageIndex,
                            DETAIL_PAGE_SIZE,
                            loadedCount,
                            total,
                            "saved versions",
                          )
                  }
                />
              ) : null}
            </div>
          </Table.Td>
        </Table.Tr>
      ) : null}
      {rows.map((row) => (
        <PayoutReportRow
          key={rowId(row)}
          row={row}
          columns={columns}
          companies={companies}
          selected={selectedRowId === rowId(row)}
          onSelect={() => {
            onSelect(row);
          }}
          scopeKey={scopeKey}
          label={label}
        />
      ))}
    </>
  );
}
