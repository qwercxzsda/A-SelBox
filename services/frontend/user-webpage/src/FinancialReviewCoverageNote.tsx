import { Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { buildFinancialReviewCoverage } from "./financial-review-coverage";
import { isUnmappedSourceAmount } from "./financial-review-categories";
import "./FinancialReviewCoverageNote.css";

function coveredRecordsMessage(rows: readonly CanonicalRow[], totalMonths: number): string | null {
  if (!rows.length) return null;
  const coverage = buildFinancialReviewCoverage(rows);
  const scope = rows.length === totalMonths ? "this scope" : "months mapped to both sources";
  if (coverage.financesRowCount === "0" && coverage.dataKioskRowCount === "0")
    return `No source records in ${scope}.`;
  if (coverage.financesRowCount === "0")
    return `No Finances records in ${scope}. Its covered amounts are shown as zero.`;
  if (coverage.dataKioskRowCount === "0")
    return `No Data Kiosk records in ${scope}. Its covered amounts are shown as zero.`;
  const oneSided = coverage.months.onlyFinances + coverage.months.onlyDataKiosk;
  return oneSided
    ? `${String(oneSided)} of ${String(coverage.monthCount)} mapped months have records from only one source. Covered missing-source amounts are shown as zero.`
    : null;
}

export function FinancialReviewCoverageNote({ rows }: { rows: readonly CanonicalRow[] }) {
  if (!rows.length) return null;
  const financesRows = rows.filter((row) => !isUnmappedSourceAmount(row, "finances_amount"));
  const kioskRows = rows.filter((row) => !isUnmappedSourceAmount(row, "data_kiosk_amount"));
  const pairedRows = rows.filter(
    (row) =>
      !isUnmappedSourceAmount(row, "finances_amount") &&
      !isUnmappedSourceAmount(row, "data_kiosk_amount"),
  );
  const financesCount = buildFinancialReviewCoverage(financesRows).financesRowCount;
  const kioskCount = buildFinancialReviewCoverage(kioskRows).dataKioskRowCount;
  const messages: string[] = [];
  if (!financesRows.length)
    messages.push("No Finances types are mapped for the selected families.");
  else if (!kioskRows.length)
    messages.push("No Data Kiosk types are mapped for the selected families.");
  else if (pairedRows.length !== rows.length)
    messages.push("Some selected activity has no verified counterpart mapping.");

  const incomplete =
    (financesRows.length > 0 &&
      (financesCount === null || financesRows.some((row) => row.finances_covered === "false"))) ||
    (kioskRows.length > 0 &&
      (kioskCount === null || kioskRows.some((row) => row.data_kiosk_covered === "false")));
  const retrievalMessage = incomplete
    ? "Source retrieval coverage is incomplete for part of this comparison. Unavailable mapped amounts are not treated as zero."
    : coveredRecordsMessage(pairedRows, rows.length);
  if (retrievalMessage) messages.push(retrievalMessage);
  if (!messages.length) return null;
  const count = (value: string | null) =>
    value === null ? "Unavailable" : BigInt(value).toLocaleString("en-US");
  return (
    <div className="financial-review-coverage-note" role="note" aria-label="Source availability">
      {messages.map((message) => (
        <Text key={message} size="sm" fw={500}>
          {message}
        </Text>
      ))}
      <Text size="xs" c="dimmed">
        Records · Finances: {financesRows.length ? count(financesCount) : "No mapped types"} · Data
        Kiosk: {kioskRows.length ? count(kioskCount) : "No mapped types"}
      </Text>
    </div>
  );
}
