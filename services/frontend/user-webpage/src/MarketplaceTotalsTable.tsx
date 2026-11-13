import { Skeleton, UnstyledButton, VisuallyHidden } from "@mantine/core";
import type { MarketplaceCurrencyTotal } from "./api";
import { formatAmount, formatMoney } from "./decimal";
import type { MarketplaceSummary, OpenSummaryBreakdown, SummaryState } from "./summary-types";
import { TOTALS_PERIOD_LABELS, type PeriodDefinition, type TotalsPeriod } from "./summary-periods";

function Amount({ value, currency }: { value: string | null; currency: string }) {
  return (
    <>
      {formatAmount(value)}
      {value !== null ? <VisuallyHidden> {currency}</VisuallyHidden> : null}
    </>
  );
}

function TotalRow({
  marketplace,
  definition,
  title,
  total,
  onOpenBreakdown,
}: {
  marketplace: string;
  definition: PeriodDefinition;
  title: string;
  total: MarketplaceCurrencyTotal;
  onOpenBreakdown: OpenSummaryBreakdown;
}) {
  return (
    <tr aria-label={`${marketplace} ${total.currency} totals`} data-currency={total.currency}>
      <th scope="row" className="totals-currency">
        <span>{total.currency}</span>
        <small
          className="totals-records"
          data-record-count={total.rowCount}
          aria-label={`${String(total.rowCount)} records`}
        >
          {total.rowCount.toLocaleString("en-US")} {total.rowCount === 1 ? "row" : "rows"}
        </small>
      </th>
      <td className="totals-number" data-amount-field="reportedAmount">
        <Amount value={total.reportedAmount} currency={total.currency} />
      </td>
      <td className="totals-number" data-amount-field="serviceFee">
        <Amount value={total.serviceFee} currency={total.currency} />
      </td>
      <td className="totals-number totals-company-amount">
        <UnstyledButton
          type="button"
          className="totals-company-action ui-text-action"
          aria-label={`View ${title} for ${marketplace} in ${total.currency} by type: ${formatMoney(total.companyAmount, total.currency)}`}
          aria-haspopup="dialog"
          onClick={() => {
            onOpenBreakdown(definition, title, total.currency, marketplace);
          }}
        >
          <span data-amount-field="companyAmount">
            <Amount value={total.companyAmount} currency={total.currency} />
          </span>
        </UnstyledButton>
        {total.missingFeeCount > 0 ? (
          <small className="totals-known-amount" role="note">
            Known amount · {total.missingFeeCount.toLocaleString("en-US")} uncalculated
          </small>
        ) : null}
      </td>
    </tr>
  );
}

export function MarketplaceTotalsTable({
  groups,
  period,
  state,
  onOpenBreakdown,
}: {
  groups: MarketplaceSummary[];
  period: TotalsPeriod;
  state: SummaryState;
  onOpenBreakdown: OpenSummaryBreakdown;
}) {
  const title = TOTALS_PERIOD_LABELS[period];
  const definition = state.definition;
  return (
    <table className="marketplace-totals-table" aria-label={`${title} marketplace totals`}>
      <thead>
        <tr>
          <th scope="col">Currency</th>
          <th scope="col" className="totals-number">
            Reported amount
          </th>
          <th scope="col" className="totals-number">
            Service fee
          </th>
          <th scope="col" className="totals-number">
            Company amount
          </th>
        </tr>
      </thead>
      {groups.map((group) => {
        const totals = [...group[period]].sort((a, b) => a.currency.localeCompare(b.currency));
        return (
          <tbody key={group.marketplace} data-marketplace={group.marketplace}>
            <tr
              aria-label={`${group.marketplace} totals`}
              className={`totals-market-heading${totals.length === 0 ? " totals-empty-row" : ""}`}
            >
              <th scope="rowgroup" colSpan={4}>
                <div className="totals-market-heading-content">
                  <span className="totals-marketplace-name">{group.marketplace}</span>
                  <span className="totals-marketplace-meta">
                    {totals.length === 0 ? (
                      state.pending ? (
                        <Skeleton
                          height={10}
                          width={65}
                          aria-label={`Loading ${group.marketplace} ${title.toLowerCase()} totals`}
                        />
                      ) : (
                        <span className="totals-empty-value">
                          {state.error
                            ? "Unavailable"
                            : period === "selected" && definition === null
                              ? "Choose dates"
                              : "No transactions"}
                        </span>
                      )
                    ) : null}
                  </span>
                </div>
              </th>
            </tr>
            {definition &&
              totals.map((total) => (
                <TotalRow
                  key={total.currency}
                  {...{ definition, title, total, onOpenBreakdown }}
                  marketplace={group.marketplace}
                />
              ))}
          </tbody>
        );
      })}
    </table>
  );
}
