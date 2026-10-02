import { inspectableRowProps } from "./inspectable-row";
import { Fragment, useId, useRef, type ReactNode } from "react";
import { Badge, Button, Group, Paper, Table, Text } from "@mantine/core";
import type { CanonicalRow, DatasetFilters } from "./api";
import type { DatasetSort } from "./api/types";
import type { Identity } from "./auth-session";
import { TableCellValue } from "./Cell";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { PayoutReportHistory } from "./PayoutReportHistory";
import { MonthGroupCell } from "./MonthGroupCell";
import { TableScrollControls } from "./TableScrollControls";
import { formatRecordMonth } from "./date-display";
import { companyLabel, displayColumns, rowId } from "./view-model";
import { groupPayoutReports, payoutScopeKey, type PayoutHistoryState } from "./payout-report-view";

export function PayoutReportsTable({
  identity,
  rows,
  companies,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  totalCount,
  isBusy,
  history,
  onToggleHistory,
  onHistoryPageChange,
  selectedRowId,
  onSelect,
  onSelectVersion,
  status,
  children,
  fixedMonth = false,
}: {
  identity: Identity;
  rows: CanonicalRow[];
  companies: Map<string, string>;
  filters: DatasetFilters;
  onFiltersChange: (patch: Partial<DatasetFilters>) => void;
  sort: DatasetSort;
  onSortChange: (sort: DatasetSort) => void;
  totalCount: number | null;
  isBusy: boolean;
  history: PayoutHistoryState;
  onToggleHistory: (key: string) => void;
  onHistoryPageChange: (key: string, page: number) => void;
  selectedRowId: string | null;
  onSelect: (id: string | null) => void;
  onSelectVersion: (row: CanonicalRow) => void;
  status: ReactNode;
  children: ReactNode;
  fixedMonth?: boolean;
}) {
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  const columns = displayColumns("payouts", identity.account.access_role === "operator");
  const reportColumns = columns.filter((column) => column.key !== "start_date");
  return (
    <>
      <Group justify="space-between" gap="xs" mb="xs" mih={22}>
        <Text size="xs" c="dimmed">
          {fixedMonth
            ? "Saved reports for this month. "
            : `Filter by month${identity.account.access_role === "operator" ? " or company" : ""} in the column headings. `}
          Select a report for details, or show its previous versions.
        </Text>
        <Group gap="xs">
          <TableScrollControls target={scrollTarget} targetId={scrollId} />
          {status}
        </Group>
      </Group>
      <Paper withBorder className="table-card payout-reports-card" aria-busy={isBusy}>
        <div
          id={scrollId}
          ref={scrollTarget}
          className="table-horizontal-scroll"
          role="region"
          aria-label="Financial table"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
          tabIndex={0}
        >
          <Table
            className="payout-reports-table month-grouped-table"
            aria-label="Financial records"
            highlightOnHover
          >
            <Table.Thead>
              <Table.Tr>
                {columns.map((column) => (
                  <Table.Th
                    key={column.key}
                    data-column={column.key}
                    scope="col"
                    className={column.align === "right" ? "numeric" : undefined}
                    aria-sort={
                      column.sortable
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    {fixedMonth && column.key === "start_date" ? (
                      column.label
                    ) : (
                      <FinanceColumnHeader
                        column={column}
                        dataset="payouts"
                        identity={identity}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        sort={sort}
                        onSortChange={onSortChange}
                        totalCount={totalCount}
                      />
                    )}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            {groupPayoutReports(rows).map(({ month, reports }) => {
              const monthLabel = formatRecordMonth(month);
              const rowSpan =
                reports.length +
                reports.filter((row) => history.expanded.includes(payoutScopeKey(row))).length;
              return (
                <Table.Tbody key={month} className="payout-month-group" aria-label={monthLabel}>
                  {reports.map((row, index) => {
                    const id = rowId(row);
                    const scopeKey = payoutScopeKey(row);
                    const expanded = history.expanded.includes(scopeKey);
                    const label = `${companyLabel(row.company_id, companies)} · ${monthLabel} · ${row.currency ?? "No currency"}`;
                    return (
                      <Fragment key={id}>
                        <Table.Tr
                          {...inspectableRowProps(selectedRowId === id, () => {
                            onSelect(id);
                          })}
                        >
                          {index === 0 ? (
                            <MonthGroupCell
                              month={month}
                              rowSpan={rowSpan}
                              description={`${String(reports.length)} ${reports.length === 1 ? "report" : "reports"} on this page`}
                            />
                          ) : null}
                          {reportColumns.map((column) => (
                            <Table.Td
                              key={column.key}
                              data-column={column.key}
                              className={column.align === "right" ? "numeric" : undefined}
                            >
                              {column.key === "created_at" ? (
                                <div className="payout-report-updated">
                                  <Group gap={6} wrap="nowrap">
                                    <Badge size="xs" variant="light" color="teal">
                                      Latest
                                    </Badge>
                                    <TableCellValue
                                      column={column}
                                      row={row}
                                      companies={companies}
                                    />
                                  </Group>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    aria-expanded={expanded}
                                    aria-label={`${expanded ? "Hide" : "Show"} versions for ${label}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onToggleHistory(scopeKey);
                                    }}
                                  >
                                    {expanded ? "Hide versions" : "Show versions"}
                                  </Button>
                                </div>
                              ) : (
                                <TableCellValue column={column} row={row} companies={companies} />
                              )}
                            </Table.Td>
                          ))}
                        </Table.Tr>
                        {expanded ? (
                          <Table.Tr className="payout-history-row">
                            <Table.Td colSpan={reportColumns.length}>
                              <PayoutReportHistory
                                identity={identity}
                                latest={row}
                                label={label}
                                pageIndex={history.pages[scopeKey] ?? 0}
                                onPageChange={(page) => {
                                  onHistoryPageChange(scopeKey, page);
                                }}
                                onSelect={onSelectVersion}
                              />
                            </Table.Td>
                          </Table.Tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
              );
            })}
          </Table>
          {children}
        </div>
      </Paper>
    </>
  );
}
