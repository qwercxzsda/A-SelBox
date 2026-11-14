import type { MarketplaceCurrencyTotal } from "./api/types";
import type { PeriodDefinition, TotalsPeriod } from "./summary-periods";

export interface SummaryState {
  definition: PeriodDefinition | null;
  pending: boolean;
  error: string | null;
}

export interface MarketplaceSummary extends Record<TotalsPeriod, MarketplaceCurrencyTotal[]> {
  marketplace: string;
}

export type OpenSummaryBreakdown = (
  period: PeriodDefinition,
  title: string,
  currency: string,
  marketplace: string,
) => void;
