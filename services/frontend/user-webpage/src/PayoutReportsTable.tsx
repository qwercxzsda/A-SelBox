import { Fragment, type ReactNode } from "react";
import { Table } from "@mantine/core";
import type { CanonicalRow, DatasetFilters } from "./api";
import type { DatasetSort } from "./api/types";
import type { Identity } from "./auth-session";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { PayoutReportHistory } from "./PayoutReportHistory";
import { PayoutReportRow } from "./PayoutReportRow";
import { usePayoutReportHistories } from "./use-payout-report-histories";
import { MonthGroupCell } from "./MonthGroupCell";
import { TableFrame } from "./TableFrame";
import { formatRecordMonth } from "./date-display";
import { companyLabel, displayColumns, rowId } from "./view-model";
import { groupPayoutReports, type PayoutHistoryState } from "./payout-report-view";
import { payoutMarketplaceLabel, payoutScopeKey } from "./payout-report-scope";

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
  fixedMarketplace = false,
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
  fixedMarketplace?: boolean;
}) {
  const columns = displayColumns("payouts", identity.account.access_role === "administrator");
  const reportColumns = columns.filter((column) => column.key !== "start_date");
  const versionColumns = reportColumns.filter(
    (column) => column.key !== "company_id" && column.key !== "marketplace_name",
  );
  const histories = usePayoutReportHistories(identity, rows, history, onHistoryPageChange);
  return (
    <TableFrame label="Financial table" isBusy={isBusy} status={status}>
      <Table
        className="payout-reports-table month-grouped-table"
        data-company-column={identity.account.access_role === "administrator" || undefined}
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
                {(fixedMonth && column.key === "start_date") ||
                (fixedMarketplace && column.key === "marketplace_name") ? (
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
            reports.reduce(
              (count, row) => count + (histories.get(payoutScopeKey(row))?.rowCount ?? 0),
              0,
            );
          return (
            <Table.Tbody key={month} className="payout-month-group" aria-label={monthLabel}>
              {reports.map((row, index) => {
                const id = rowId(row);
                const scopeKey = payoutScopeKey(row);
                const versionPage = histories.get(scopeKey);
                const label = `${companyLabel(row.company_id, companies)} · ${monthLabel} · ${payoutMarketplaceLabel(row)} · ${row.currency ?? "No currency"}`;
                return (
                  <Fragment key={id}>
                    <PayoutReportRow
                      row={row}
                      columns={reportColumns}
                      companies={companies}
                      selected={selectedRowId === id}
                      onSelect={() => {
                        onSelect(id);
                      }}
                      scopeKey={scopeKey}
                      label={label}
                      history={{
                        expanded: versionPage !== undefined,
                        rowSpan: 1 + (versionPage?.rowCount ?? 0),
                        updating: Boolean(
                          versionPage?.query.isFetching && !versionPage.query.isPending,
                        ),
                        onToggle: () => {
                          onToggleHistory(scopeKey);
                        },
                      }}
                    >
                      {index === 0 ? (
                        <MonthGroupCell
                          month={month}
                          rowSpan={rowSpan}
                          description={`${String(reports.length)} latest ${reports.length === 1 ? "report" : "reports"}`}
                        />
                      ) : null}
                    </PayoutReportRow>
                    {versionPage ? (
                      <PayoutReportHistory
                        page={versionPage}
                        scopeKey={scopeKey}
                        label={label}
                        columns={versionColumns}
                        companies={companies}
                        onPageChange={(page) => {
                          onHistoryPageChange(scopeKey, page);
                        }}
                        onSelect={onSelectVersion}
                        selectedRowId={selectedRowId}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          );
        })}
      </Table>
      {children}
    </TableFrame>
  );
}
