import type { SkuConfigurationPeriod } from "./api/sku-configuration-types.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { isCalendarDate, isMarketplace } from "./sku-fee-coverage.ts";

export interface FeeRateChangeDraft {
  periodIndex: number;
  effectiveDate: string;
  feeRatePercent: string;
  previewRequested: boolean;
}

/** Split one existing interval without changing coverage or rounding its rate. */
export function planFeeRateChange(
  periods: readonly SkuConfigurationPeriod[],
  draft: FeeRateChangeDraft,
) {
  const period =
    Number.isSafeInteger(draft.periodIndex) && draft.periodIndex >= 0
      ? periods.at(draft.periodIndex)
      : undefined;
  const errors: { period?: string; effectiveDate?: string; feeRatePercent?: string } = {};
  if (
    !period ||
    !isMarketplace(period.marketplace_name) ||
    !isFeeRate(period.fee_rate_percent) ||
    !isCalendarDate(period.valid_from) ||
    (period.valid_to !== null &&
      (!isCalendarDate(period.valid_to) || period.valid_to <= period.valid_from))
  )
    errors.period = "Complete the existing marketplace and date range before changing its rate.";
  if (!isCalendarDate(draft.effectiveDate)) errors.effectiveDate = "Choose a valid effective date.";
  else if (
    period &&
    (draft.effectiveDate < period.valid_from ||
      (period.valid_to !== null && draft.effectiveDate >= period.valid_to))
  )
    errors.effectiveDate = "Choose a date within this period. Its end date is exclusive.";
  if (!isFeeRate(draft.feeRatePercent))
    errors.feeRatePercent = "Enter a fee from 0 to 100 with up to 6 decimal places.";
  if (!period || Object.keys(errors).length) return { errors, plan: null };
  const replacement = [
    ...(draft.effectiveDate > period.valid_from
      ? [{ ...period, valid_to: draft.effectiveDate }]
      : []),
    { ...period, valid_from: draft.effectiveDate, fee_rate_percent: draft.feeRatePercent },
  ];
  return {
    errors,
    plan: {
      before: period,
      replacement,
      periods: periods.flatMap((entry, index) =>
        index === draft.periodIndex ? replacement : [{ ...entry }],
      ),
    },
  };
}
