import type { SkuConfigurationPeriod } from "./api/sku-configuration-types.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { FEE_DATE_ERROR } from "./fee-period-labels.ts";
import { FEE_RATE_ERROR } from "./sku-configuration-form.ts";
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
    errors.period = "Complete this period's marketplace and dates first.";
  if (!isCalendarDate(draft.effectiveDate)) errors.effectiveDate = FEE_DATE_ERROR;
  else if (
    period &&
    (draft.effectiveDate < period.valid_from ||
      (period.valid_to !== null && draft.effectiveDate >= period.valid_to))
  )
    errors.effectiveDate = "Choose a date inside this period.";
  if (!isFeeRate(draft.feeRatePercent)) errors.feeRatePercent = FEE_RATE_ERROR;
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
