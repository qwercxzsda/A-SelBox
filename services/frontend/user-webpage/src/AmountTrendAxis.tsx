import { formatMoney } from "./decimal";
import { chartPercentage, formatAmountTrendTick } from "./amount-trend-format";

/** The same exact amount ticks can sit inside a plot or beside its scroll viewport. */
export function AmountTrendAxis({
  currency,
  ticks,
}: {
  currency: string;
  ticks: readonly { value: string; y: number }[];
}) {
  return (
    <>
      <span className="amount-trend-axis-currency">{currency}</span>
      {ticks.map((tick) => (
        <span
          key={tick.value}
          className="amount-trend-axis-label"
          style={{ top: chartPercentage(tick.y) }}
          title={formatMoney(tick.value, currency)}
        >
          {formatAmountTrendTick(tick.value)}
        </span>
      ))}
    </>
  );
}
