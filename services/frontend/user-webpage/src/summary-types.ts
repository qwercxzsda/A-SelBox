import type { CurrencyTotal } from "./api";
import type { PeriodDefinition } from "./estimated-periods";

export interface SummaryPeriod extends PeriodDefinition {
  totals: CurrencyTotal[];
}

export interface SummaryState {
  period: SummaryPeriod | null;
  pending: boolean;
  error: string | null;
}
