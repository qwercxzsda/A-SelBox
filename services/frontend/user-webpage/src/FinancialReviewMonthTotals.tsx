import type { CanonicalRow } from "./api";
import { DetailTable } from "./DetailTable";
import { formatAmount } from "./decimal";
import { reviewAmountColumns, type ReviewCategory } from "./financial-review-categories";

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
        />
      </div>
      <section className="monthly-review-totals-mobile" aria-label="Financial review totals">
        {rows.map((row) => (
          <dl key={row.currency}>
            {columns.map((column) => {
              const difference = column.key === "difference";
              const noSourceRecords =
                !difference && row[column.key.replace("_amount", "_row_count")] === "0";
              return (
                <div key={column.key} data-difference={difference || undefined}>
                  <dt>{difference ? "Difference" : column.label}</dt>
                  <dd>
                    {formatAmount(row[column.key])}
                    {noSourceRecords ? <span>No source records</span> : null}
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
