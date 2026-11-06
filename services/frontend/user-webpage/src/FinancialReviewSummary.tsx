import { Paper, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { formatMoney } from "./decimal";
import { sumCompleteDecimals } from "./source-diagnostics";
import { formatRecordMonth } from "./date-display";
import { FinancialReviewCoverageNote } from "./FinancialReviewCoverageNote";

const TOTALS = [
  ["finances_amount", "Finances total"],
  ["data_kiosk_amount", "Data Kiosk total"],
  ["difference", "Period difference"],
] as const;

export function FinancialReviewSummary({
  rows,
  currency,
  year,
}: {
  rows: CanonicalRow[];
  currency: string;
  year: string;
}) {
  return (
    <section className="financial-review-summary" aria-label={`${year} review totals`}>
      <Text size="xs" c="dimmed" className="financial-review-summary-period">
        {formatRecordMonth(rows[0].month ?? "")} –{" "}
        {formatRecordMonth(rows[rows.length - 1].month ?? "")} · {rows.length}{" "}
        {rows.length === 1 ? "month" : "months"} with source records
      </Text>
      {TOTALS.map(([field, label]) => (
        <Paper
          key={field}
          withBorder
          p="md"
          className="financial-review-summary-card"
          data-difference={field === "difference"}
        >
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text className="financial-review-summary-value">
            {formatMoney(sumCompleteDecimals(rows.map((row) => row[field])), currency)}
          </Text>
        </Paper>
      ))}
      <FinancialReviewCoverageNote rows={rows} />
    </section>
  );
}
