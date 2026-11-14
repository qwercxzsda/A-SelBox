import { Button, Table, Text, Title } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { inspectableRowProps } from "./inspectable-row";
import { TableFrame } from "./TableFrame";
import { formatRecordMonth } from "./date-display";
import { formatAmount } from "./decimal";
import {
  hasNoSourceRecords,
  isUnmappedSourceAmount,
  type ReviewCategory,
} from "./financial-review-categories";

export function FinancialReviewMonthTable({
  rows,
  currency,
  selectedMonth,
  onSelect,
  isBusy,
  emptyMessage,
  category,
  onClearFamilies,
}: {
  rows: CanonicalRow[];
  currency: string;
  selectedMonth: string | null;
  onSelect: (month: string) => void;
  isBusy: boolean;
  emptyMessage: string | undefined;
  category: ReviewCategory;
  onClearFamilies?: () => void;
}) {
  const amount = category === "DATA_KIOSK" ? "costs" : "amount";
  return (
    <section className="financial-review-month-list" aria-label="Monthly amounts">
      <TableFrame
        label="Monthly financial review table"
        isBusy={isBusy}
        heading={
          <Title order={3} size="h4" className="detail-section-title">
            Monthly amounts{currency ? ` · ${currency}` : ""}
          </Title>
        }
      >
        <Table
          className="financial-review-months-table"
          aria-label="Monthly financial review"
          highlightOnHover
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Month</Table.Th>
              <Table.Th scope="col" className="numeric">
                Finances {amount}
              </Table.Th>
              <Table.Th scope="col" className="numeric">
                Data Kiosk {amount}
              </Table.Th>
              <Table.Th scope="col" className="numeric">
                Monthly source gap
              </Table.Th>
              <Table.Th scope="col" className="numeric">
                Running source gap
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          {rows.map((row) => {
            const month = row.month?.slice(0, 7) ?? "";
            const label = formatRecordMonth(month);
            return (
              <Table.Tbody key={month} aria-label={label}>
                <Table.Tr
                  {...inspectableRowProps(selectedMonth === month, () => {
                    onSelect(month);
                  })}
                >
                  <Table.Th scope="row" className="financial-review-month-cell">
                    <Button
                      className="financial-review-months-open ui-text-action"
                      size="compact-sm"
                      variant="subtle"
                      aria-label={`Open review for ${label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.currentTarget.focus({ preventScroll: true });
                        onSelect(month);
                      }}
                    >
                      {label}
                    </Button>
                  </Table.Th>
                  {["finances_amount", "data_kiosk_amount"].map((key) => (
                    <Table.Td key={key} className="numeric">
                      {isUnmappedSourceAmount(row, key)
                        ? "No mapped types"
                        : formatAmount(row[key])}
                      {hasNoSourceRecords(row, key) ? (
                        <Text size="xs" c="dimmed">
                          No source records
                        </Text>
                      ) : null}
                    </Table.Td>
                  ))}
                  <Table.Td className="numeric">{formatAmount(row.difference)}</Table.Td>
                  <Table.Td className="numeric financial-review-running">
                    {formatAmount(row.running_difference)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            );
          })}
          {!rows.length && emptyMessage ? (
            <Table.Tbody>
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text
                    className="financial-review-months-empty"
                    size="sm"
                    c="dimmed"
                    role="status"
                  >
                    {emptyMessage}
                  </Text>
                  {onClearFamilies ? (
                    <Button variant="light" onClick={onClearFamilies} mb="md">
                      Show all families
                    </Button>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          ) : null}
        </Table>
      </TableFrame>
    </section>
  );
}
