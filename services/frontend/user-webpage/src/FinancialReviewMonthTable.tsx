import { inspectableRowProps } from "./inspectable-row";
import { useId, useRef } from "react";
import { Badge, Button, Group, Paper, Table, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { TableScrollControls } from "./TableScrollControls";
import { formatRecordMonth } from "./date-display";
import { formatExactDecimal } from "./decimal";
import { groupFinancialReviewMonths } from "./financial-review-view";
import { ColumnMenu } from "./ColumnMenu";
import { MonthGroupCell } from "./MonthGroupCell";
import { UpdateStatus } from "./UpdateStatus";
import { reviewAmountColumns, type ReviewCategory } from "./financial-review-categories";
import { TableColumnLabel } from "./TableColumnLabel";

export function FinancialReviewMonthTable({
  rows,
  selectedMonth,
  onSelect,
  filterMonth,
  onFilterMonth,
  matureCutoff,
  isBusy,
  emptyMessage,
  category,
}: {
  rows: CanonicalRow[];
  selectedMonth: string | null;
  onSelect: (month: string) => void;
  filterMonth: string;
  onFilterMonth: (month: string) => void;
  matureCutoff: string;
  isBusy: boolean;
  emptyMessage: string;
  category: ReviewCategory;
}) {
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return (
    <>
      <Group justify="space-between" gap="xs" mb="xs">
        <Text size="xs" c="dimmed">
          Filter by month in the column heading. Open a month for amounts by type and source
          records.
        </Text>
        <Group gap="xs">
          <UpdateStatus active={isBusy}>Updating monthly summaries…</UpdateStatus>
          <TableScrollControls target={scrollTarget} targetId={scrollId} />
        </Group>
      </Group>
      <Paper withBorder className="table-card financial-review-months-card" aria-busy={isBusy}>
        <div
          id={scrollId}
          ref={scrollTarget}
          className="table-horizontal-scroll"
          role="region"
          aria-label="Monthly financial review table"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
          tabIndex={0}
        >
          <Table
            className="financial-review-months-table month-grouped-table"
            aria-label="Monthly financial review"
            highlightOnHover
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">
                  <ColumnMenu
                    label="Month"
                    filter={{ kind: "month", value: filterMonth, onChange: onFilterMonth }}
                  />
                </Table.Th>
                {reviewAmountColumns(category).map((column) => (
                  <Table.Th
                    key={column.key}
                    scope="col"
                    className={column.kind === "number" ? "numeric" : undefined}
                  >
                    <TableColumnLabel label={column.label} />
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            {groupFinancialReviewMonths(rows).map(({ month, currencies }) => {
              const label = formatRecordMonth(month);
              return (
                <Table.Tbody key={month} aria-label={label}>
                  {currencies.map((row, index) => (
                    <Table.Tr
                      key={row.currency ?? ""}
                      {...inspectableRowProps(selectedMonth === month, () => {
                        onSelect(month);
                      })}
                    >
                      {index === 0 ? (
                        <MonthGroupCell
                          month={month}
                          rowSpan={currencies.length}
                          description={`${String(currencies.length)} ${currencies.length === 1 ? "currency" : "currencies"}`}
                        >
                          {month === matureCutoff.slice(0, 7) ? (
                            <Badge
                              mt="xs"
                              size="xs"
                              color="gray"
                              variant="light"
                              title={`Includes mature dates before ${matureCutoff} only.`}
                            >
                              Partial month
                            </Badge>
                          ) : null}
                          <Button
                            className="financial-review-months-open"
                            size="compact-xs"
                            variant="subtle"
                            aria-label={`Open review for ${label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect(month);
                            }}
                          >
                            Open review
                          </Button>
                        </MonthGroupCell>
                      ) : null}
                      <Table.Td>{row.currency ?? "—"}</Table.Td>
                      <Table.Td className="numeric">
                        {formatExactDecimal(row.settlement_amount)}
                        {row.settlement_row_count === "0" ? (
                          <Text size="xs" c="dimmed">
                            No source rows
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td className="numeric">
                        {formatExactDecimal(row.data_kiosk_amount)}
                        {row.data_kiosk_row_count === "0" ? (
                          <Text size="xs" c="dimmed">
                            No source rows
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td className="numeric financial-review-months-difference">
                        {formatExactDecimal(row.difference)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              );
            })}
            {rows.length === 0 ? (
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <div className="financial-review-months-empty">
                      <Text size="sm" c="dimmed" role="status">
                        {emptyMessage}
                      </Text>
                      {filterMonth && !isBusy ? (
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => {
                            onFilterMonth("");
                          }}
                        >
                          Clear month filter
                        </Button>
                      ) : null}
                    </div>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            ) : null}
          </Table>
        </div>
      </Paper>
    </>
  );
}
