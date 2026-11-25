import type { CanonicalRow } from "./api";
import type { FinancialSourceSelection } from "./api/financial-source";
import { asReviewReason, asSelboxGroup, type ReviewOutcome } from "./api/financial-review";
import { humanizeCode, REVIEW_REASON_LABELS, SELBOX_GROUP_LABELS } from "./categories";
import { formatExactAmount, sumExactDecimals } from "./decimal";
import type { DetailColumn } from "./detail-columns";
import { DetailTable } from "./DetailTable";
import { StackedValue } from "./StackedValue";

const DIFFERENCE_COLUMNS: DetailColumn[] = [
  { key: "posted_date", label: "Posting date", kind: "date" },
  { key: "component_type", label: "Type", kind: "type" },
  { key: "source", label: "Source", kind: "source" },
  { key: "reference_id", label: "Reference ID" },
  { key: "sku", label: "SKU" },
  { key: "amount", label: "Amount", kind: "amount" },
];
const SELBOX_COLUMNS: DetailColumn[] = [
  { key: "posted_date", label: "Posting date", kind: "date" },
  { key: "component_type", label: "Type", kind: "type" },
  { key: "source", label: "Source", kind: "source" },
  { key: "amount", label: "Amount", kind: "amount" },
];
const CODE_COLUMNS: Record<ReviewOutcome, DetailColumn> = {
  DIFFERENCE: { key: "reason", label: "Reason" },
  SELBOX: { key: "selbox_group", label: "Group" },
};

/** An opened record: the source record it shows and the row that opened it. */
export interface OpenedOutcome {
  key: string;
  source: FinancialSourceSelection;
}

/** Balancing entries of one charge share its source IDs, so the key also names reason and group. */
function recordKey(row: CanonicalRow) {
  return JSON.stringify([
    row.source,
    row.source_row_id,
    row.source_version_id,
    row.reason,
    row.selbox_group,
    row.sku,
  ]);
}

/** A balancing entry (KEY) is computed from a Finances charge and opens that charge's record. */
function opensFinances(row: CanonicalRow) {
  return row.source === "FINANCES" || row.source === "KEY";
}

/** Only Finances records have a source-record view. */
function sourceSelection(row: CanonicalRow): FinancialSourceSelection | null {
  return opensFinances(row) && row.source_row_id && row.source_version_id
    ? { source: "FINANCES", rowId: row.source_row_id, versionId: row.source_version_id }
    : null;
}

/** One page of a month's differences or SelBox types, amounts including tax. */
export function FinancialReviewOutcomeTable({
  label,
  outcome,
  rows,
  currency,
  showCode,
  openedKey,
  onOpenRecord,
}: {
  label: string;
  outcome: ReviewOutcome;
  rows: CanonicalRow[];
  currency: string;
  /** False when one reason or group is selected, so every row shares it. */
  showCode: boolean;
  /** The key of the row whose record is open. */
  openedKey: string | null;
  onOpenRecord: (opened: OpenedOutcome) => void;
}) {
  const columns = outcome === "DIFFERENCE" ? DIFFERENCE_COLUMNS : SELBOX_COLUMNS;
  return (
    <DetailTable
      label={label}
      columns={showCode ? [...columns, CODE_COLUMNS[outcome]] : columns}
      rows={rows}
      rowKey={recordKey}
      minWidth={outcome === "DIFFERENCE" ? 860 : 620}
      selectedRowKey={openedKey}
      canSelectRow={(row) => sourceSelection(row) !== null}
      onSelectRow={(row) => {
        const source = sourceSelection(row);
        if (source) onOpenRecord({ key: recordKey(row), source });
      }}
      renderCell={(row, column) => {
        if (column.key === "source" && row.source === "KEY") return humanizeCode("FINANCES");
        if (column.key === "amount")
          return (
            <StackedValue
              value={formatExactAmount(
                sumExactDecimals([row.base_amount, row.tax_amount]),
                currency,
              )}
              details={[["Tax", formatExactAmount(row.tax_amount, currency)]]}
            />
          );
        if (column.key === "sku")
          return (
            <StackedValue
              value={row.sku}
              details={[
                ["FNSKU", row.fnsku],
                ["ASIN", row.asin],
              ]}
            />
          );
        const reason = column.key === "reason" ? asReviewReason(row.reason) : null;
        if (reason) return REVIEW_REASON_LABELS[reason];
        const group = column.key === "selbox_group" ? asSelboxGroup(row.selbox_group) : null;
        return group ? SELBOX_GROUP_LABELS[group] : undefined;
      }}
    />
  );
}
