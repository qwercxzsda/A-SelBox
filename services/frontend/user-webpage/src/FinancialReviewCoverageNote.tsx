import { Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { buildFinancialReviewCoverage } from "./financial-review-coverage";
import "./FinancialReviewCoverageNote.css";

export function FinancialReviewCoverageNote({ rows }: { rows: readonly CanonicalRow[] }) {
  const coverage = buildFinancialReviewCoverage(rows);
  if (!coverage.monthCount) return null;
  const oneSided = coverage.months.onlyFinances + coverage.months.onlyDataKiosk;
  let message: string;
  if (coverage.months.unknownCounts)
    message = "Source record counts are unavailable for part of this comparison.";
  else if (coverage.financesRowCount === "0" && coverage.dataKioskRowCount === "0")
    message = "No source records in this scope.";
  else if (coverage.financesRowCount === "0")
    message =
      "No Finances records in this scope. Its amounts are shown as zero in this one-source comparison.";
  else if (coverage.dataKioskRowCount === "0")
    message =
      "No Data Kiosk records in this scope. Its amounts are shown as zero in this one-source comparison.";
  else if (oneSided)
    message = `${String(oneSided)} of ${String(coverage.monthCount)} months have records from only one source. Missing-source amounts are shown as zero.`;
  else return null;
  const count = (value: string | null) =>
    value === null ? "Unavailable" : BigInt(value).toLocaleString("en-US");
  return (
    <div className="financial-review-coverage-note" role="note" aria-label="Source availability">
      <Text size="sm" fw={500}>
        {message}
      </Text>
      <Text size="xs" c="dimmed">
        Records · Finances: {count(coverage.financesRowCount)} · Data Kiosk:{" "}
        {count(coverage.dataKioskRowCount)}
      </Text>
    </div>
  );
}
