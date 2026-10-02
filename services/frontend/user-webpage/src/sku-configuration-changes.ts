import type { SkuConfigurationPeriod } from "./api/sku-configuration-types.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { formatExactDecimal } from "./decimal.ts";

export interface FeePeriodChange {
  kind: "added" | "removed" | "rate";
  period: SkuConfigurationPeriod;
  previousRate?: string;
}

function periodKey(period: SkuConfigurationPeriod): string {
  return JSON.stringify([period.marketplace_name, period.valid_from, period.valid_to]);
}

function rateKey(rate: string): string {
  return isFeeRate(rate) ? formatExactDecimal(rate) : rate;
}

/** Compare exact intervals; changing dates is explicitly a removal and an addition. */
export function feePeriodChanges(
  saved: readonly SkuConfigurationPeriod[],
  proposed: readonly SkuConfigurationPeriod[],
): FeePeriodChange[] {
  const remaining = new Map<string, SkuConfigurationPeriod[]>();
  for (const period of saved) {
    const key = periodKey(period);
    remaining.set(key, [...(remaining.get(key) ?? []), period]);
  }
  const changes: FeePeriodChange[] = [];
  for (const period of proposed) {
    const matches = remaining.get(periodKey(period));
    // Prefer an exact rate match even when an unfinished draft contains duplicates.
    const exact = matches?.findIndex(
      (previous) => rateKey(previous.fee_rate_percent) === rateKey(period.fee_rate_percent),
    );
    const previous = matches?.splice(exact !== undefined && exact >= 0 ? exact : 0, 1)[0];
    if (!previous) changes.push({ kind: "added", period });
    else if (rateKey(previous.fee_rate_percent) !== rateKey(period.fee_rate_percent))
      changes.push({ kind: "rate", period, previousRate: previous.fee_rate_percent });
  }
  for (const periods of remaining.values())
    for (const period of periods) changes.push({ kind: "removed", period });
  return changes;
}
