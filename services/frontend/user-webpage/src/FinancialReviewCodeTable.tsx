import { useMemo, useRef } from "react";
import {
  asReviewReason,
  asSelboxGroup,
  type ReviewReason,
  type SelboxGroup,
} from "./api/financial-review";
import { AppliedFilterChips } from "./AppliedFilterChips";
import { REVIEW_REASON_LABELS, SELBOX_GROUP_LABELS } from "./categories";
import { formatExactAmount } from "./decimal";
import { DetailTable } from "./DetailTable";
import { REASON_COLORS } from "./financial-review-chart";
import type { ReviewBreakdown } from "./financial-review-model";
import { StackedValue } from "./StackedValue";

export type ReviewCode = ReviewReason | SelboxGroup;

function codeLabel(code: ReviewCode) {
  const reason = asReviewReason(code);
  const group = asSelboxGroup(code);
  return reason ? REVIEW_REASON_LABELS[reason] : group ? SELBOX_GROUP_LABELS[group] : code;
}

function CodeCell({ code }: { code: ReviewCode }) {
  const reason = asReviewReason(code);
  return (
    <span className="financial-review-code">
      {reason ? (
        <span
          className="financial-review-swatch"
          style={{ backgroundColor: REASON_COLORS[reason] }}
          aria-hidden="true"
        />
      ) : null}
      {codeLabel(code)}
    </span>
  );
}

/**
 * A month's reasons or SelBox groups, each amount including tax with the tax beneath (like the
 * totals). A row selects its code; the chip line beneath clears it.
 */
export function FinancialReviewCodeTable({
  label,
  codeName,
  breakdowns,
  selected,
  currency,
  onSelect,
}: {
  /** The table name, such as "Differences by reason". */
  label: string;
  /** The code column and chip name: "Reason" or "Group". */
  codeName: string;
  breakdowns: readonly ReviewBreakdown<ReviewCode>[];
  selected: ReviewCode | null;
  currency: string;
  onSelect: (code: ReviewCode | null) => void;
}) {
  const table = useRef<HTMLDivElement>(null);
  // A chip removed by keyboard returns focus to the row that selected it.
  const selectedRow = useMemo(
    () => ({
      get current() {
        return table.current?.querySelector<HTMLElement>('tr[aria-selected="true"]') ?? null;
      },
    }),
    [],
  );
  const byCode = (code: string | null) => breakdowns.find((breakdown) => breakdown.code === code);
  return (
    <>
      <div ref={table}>
        <DetailTable
          label={label}
          minWidth={320}
          columns={[
            { key: "code", label: codeName },
            { key: "amount", label: "Amount", kind: "amount" },
            { key: "count", label: "Records", kind: "number" },
          ]}
          rows={breakdowns.map(({ code, count }) => ({ code, count: String(count) }))}
          rowKey={(row) => row.code ?? ""}
          selectedRowKey={selected}
          onSelectRow={(row) => {
            onSelect(byCode(row.code)?.code ?? null);
          }}
          renderCell={(row, column) => {
            const breakdown = byCode(row.code);
            if (!breakdown) return undefined;
            if (column.key === "code") return <CodeCell code={breakdown.code} />;
            return column.key === "amount" ? (
              <StackedValue
                value={formatExactAmount(breakdown.amount, currency)}
                details={[["Tax", formatExactAmount(breakdown.tax, currency)]]}
              />
            ) : undefined;
          }}
        />
      </div>
      <div className="financial-review-breakdown-filters">
        <AppliedFilterChips
          label={`Applied ${codeName.toLowerCase()} filter`}
          chips={
            selected
              ? [{ key: selected, label: `${codeName}: ${codeLabel(selected)}`, clear: null }]
              : []
          }
          onChange={onSelect}
          onClearAll={() => {
            onSelect(null);
          }}
          focusTarget={selectedRow}
        />
      </div>
    </>
  );
}
