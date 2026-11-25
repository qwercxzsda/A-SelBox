import type { SkuConfigurationPeriod } from "./api/sku-configuration-types.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { isJsonObject } from "./api/validation.ts";
import { formatExactDecimal } from "./decimal.ts";
import { isSavedText } from "./saved-values.ts";
import { saveError, type SaveError } from "./save-error.ts";

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

const NAMED_SKUS = 3;

/** "Fees saved: S1, S2, S3 and 2 more", in the "<Thing> saved: <record>" form of every tab. */
/** The fee save's failure: "Could not save the fees" titles every cause. */
export function feesSaveError(error: unknown, reason?: string): SaveError {
  return saveError("save the fees", error, reason);
}

/** The save the page reloaded during: its result is unknown until saved settings reload. */
export const INTERRUPTED_FEES_SAVE = feesSaveError(
  null,
  "The page reloaded during the save. Refresh saved settings first.",
);

/** A stored fee save failure: the fee save's title with a short cause; anything else is dropped. */
export function decodeFeesSaveError(value: unknown): SaveError | null {
  return isJsonObject(value) &&
    value.title === INTERRUPTED_FEES_SAVE.title &&
    isSavedText(value.detail) &&
    value.detail.trim() !== ""
    ? { title: value.title, detail: value.detail }
    : null;
}

export function feesSavedNotice(changes: readonly { sku: string }[]): string {
  const rest = changes.length - NAMED_SKUS;
  const named = changes.slice(0, NAMED_SKUS).map(({ sku }) => sku);
  return `Fees saved: ${named.join(", ")}${rest > 0 ? ` and ${String(rest)} more` : ""}`;
}
