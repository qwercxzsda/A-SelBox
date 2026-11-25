import type { SkuConfigurationPeriod } from "./api/sku-configuration-types.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { formatExactDecimal } from "./decimal.ts";

/** "5.25%"; an unfinished draft rate shows as typed, an empty one as "Not set". */
export function feeRateLabel(rate: string): string {
  return isFeeRate(rate) ? `${formatExactDecimal(rate)}%` : rate || "Not set";
}

/** Fee periods in effect on a UTC day: start inclusive, end exclusive. */
export function currentFeePeriods(
  periods: readonly SkuConfigurationPeriod[],
  today: string,
): SkuConfigurationPeriod[] {
  return periods.filter(
    (period) =>
      period.valid_from !== "" &&
      period.valid_from <= today &&
      (period.valid_to === null || period.valid_to === "" || today < period.valid_to),
  );
}

export function utcToday(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}
