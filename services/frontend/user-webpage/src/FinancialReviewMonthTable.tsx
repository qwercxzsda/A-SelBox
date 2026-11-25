import { Table } from "@mantine/core";
import { formatRecordMonth } from "./date-display";
import { formatExactAmount } from "./decimal";
import { EmptyState } from "./EmptyState";
import type { ReviewAmount, ReviewTotalKey, ReviewYear } from "./financial-review-model";
import { inspectableRowProps } from "./inspectable-row";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { StackedValue } from "./StackedValue";

const AMOUNT_COLUMNS: readonly (readonly [ReviewTotalKey, string])[] = [
  ["finances", "Finances"],
  ["company", "Company amounts"],
  ["selbox", "SelBox types"],
  ["difference", "Differences"],
];

const COLUMNS: RecordColumn[] = [
  { key: "month", label: "Month" },
  ...AMOUNT_COLUMNS.map(([key, label]) => ({ key, label, align: "right" as const })),
  { key: "running_difference", label: "Running difference", align: "right" },
];

function AmountCell({ value, currency }: { value: ReviewAmount; currency: string }) {
  return (
    <StackedValue
      value={formatExactAmount(value.amount, currency)}
      details={[["Tax", formatExactAmount(value.tax, currency)]]}
    />
  );
}

/** One row per month with activity; a row opens that month. */
export function FinancialReviewMonthTable({
  review,
  selectedMonth,
  isPlaceholderData,
  onSelectMonth,
}: {
  review: ReviewYear | null;
  selectedMonth: string;
  isPlaceholderData: boolean;
  onSelectMonth: (month: string) => void;
}) {
  return (
    <RecordTable
      label="Months"
      columns={COLUMNS}
      minWidth={860}
      className="financial-review-months"
      isPlaceholderData={isPlaceholderData}
      emptyState={
        review && !review.months.length ? (
          <EmptyState title={`No activity in ${String(review.year)}`} />
        ) : undefined
      }
    >
      {review?.months.map(({ month, totals, runningDifference }) => (
        <Table.Tr
          key={month}
          {...inspectableRowProps(selectedMonth === month, () => {
            onSelectMonth(month);
          })}
        >
          <Table.Th scope="row" data-column="month">
            {formatRecordMonth(month)}
          </Table.Th>
          {AMOUNT_COLUMNS.map(([key]) => (
            <Table.Td key={key} data-column={key} className="numeric">
              <AmountCell value={totals[key]} currency={review.currency} />
            </Table.Td>
          ))}
          <Table.Td data-column="running_difference" className="numeric">
            {formatExactAmount(runningDifference, review.currency)}
          </Table.Td>
        </Table.Tr>
      ))}
    </RecordTable>
  );
}
