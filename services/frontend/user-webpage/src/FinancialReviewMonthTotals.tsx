import type { CanonicalRow } from "./api";
import { DetailTable } from "./DetailTable";
import { formatAmount } from "./decimal";
import {
  hasNoSourceRecords,
  isUnmappedSourceAmount,
  reviewAmountColumns,
  type ReviewCategory,
} from "./financial-review-categories";

export function FinancialReviewMonthTotals({
  rows,
  category,
}: {
  rows: CanonicalRow[];
  category: ReviewCategory;
}) {
  const columns = reviewAmountColumns(category).filter((column) => column.key !== "currency");
  return (
    <>
      <div className="monthly-review-totals-desktop">
        <DetailTable
          label="Financial review totals"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.currency ?? ""}
          minWidth={520}
          renderCell={(row, column) =>
            isUnmappedSourceAmount(row, column.key) ? "No mapped types" : undefined
          }
        />
      </div>
      <section className="monthly-review-totals-mobile" aria-label="Financial review totals">
        {rows.map((row) => (
          <dl key={row.currency}>
            {columns.map((column) => {
              const difference = column.key === "difference";
              const unmapped = isUnmappedSourceAmount(row, column.key);
              return (
                <div key={column.key} data-difference={difference || undefined}>
                  <dt>{difference ? "Source gap" : column.label}</dt>
                  <dd>
                    {unmapped ? "No mapped types" : formatAmount(row[column.key])}
                    {hasNoSourceRecords(row, column.key) ? <span>No source records</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        ))}
      </section>
    </>
  );
}
