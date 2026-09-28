import marketplaces from "./generated/marketplaces.json" with { type: "json" };
import { requireCalendarDate } from "./api/filters.ts";
import { isFeeRate } from "./api/sku-configuration-codec.ts";
import type {
  SkuConfigurationPeriod,
  SkuConfigurationRequirement,
} from "./api/sku-configuration-types.ts";

const MARKETPLACES = new Set<string>(marketplaces);
export const isMarketplace = (value: string) => MARKETPLACES.has(value);
export function isCalendarDate(value: string): boolean {
  try {
    requireCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}
interface Interval {
  valid_from: string;
  valid_to: string | null;
}
interface IndexedPeriod {
  period: SkuConfigurationPeriod;
  index: number;
}
interface MarketplacePeriods {
  periods: IndexedPeriod[];
  coverage: Interval[];
}
export type FeePeriodIndex = Map<string, MarketplacePeriods>;

function isValidPeriod(period: SkuConfigurationPeriod): boolean {
  return (
    isMarketplace(period.marketplace_name) &&
    isFeeRate(period.fee_rate_percent) &&
    isCalendarDate(period.valid_from) &&
    (period.valid_to === null ||
      (isCalendarDate(period.valid_to) && period.valid_to > period.valid_from))
  );
}

/** Validate/sort once per SKU, then merge contiguous coverage independently of its rates. */
export function indexFeePeriods(periods: readonly SkuConfigurationPeriod[]): FeePeriodIndex {
  const index: FeePeriodIndex = new Map();
  periods.forEach((period, position) => {
    if (!isValidPeriod(period)) return;
    const group = index.get(period.marketplace_name) ?? { periods: [], coverage: [] };
    group.periods.push({ period, index: position });
    index.set(period.marketplace_name, group);
  });
  for (const group of index.values()) {
    group.periods.sort((left, right) =>
      left.period.valid_from.localeCompare(right.period.valid_from),
    );
    for (const { period } of group.periods) {
      const previous = group.coverage.at(-1);
      if (!previous || (previous.valid_to !== null && period.valid_from > previous.valid_to)) {
        group.coverage.push({ valid_from: period.valid_from, valid_to: period.valid_to });
      } else if (
        previous.valid_to !== null &&
        (period.valid_to === null || period.valid_to > previous.valid_to)
      ) {
        previous.valid_to = period.valid_to;
      }
    }
  }
  return index;
}

export function overlappingFeePeriods(index: FeePeriodIndex): number[] {
  const overlaps: number[] = [];
  for (const { periods } of index.values()) {
    let end: string | null | undefined;
    for (const { period, index: position } of periods) {
      if (end !== undefined && (end === null || period.valid_from < end)) overlaps.push(position);
      if (end !== null && (end === undefined || period.valid_to === null || period.valid_to > end))
        end = period.valid_to;
    }
  }
  return overlaps;
}

export function feeCoverageGaps(
  requirements: readonly SkuConfigurationRequirement[],
  index: FeePeriodIndex,
): SkuConfigurationRequirement[] {
  return requirements.flatMap((requirement) => {
    let cursor = requirement.valid_from;
    const gaps: SkuConfigurationRequirement[] = [];
    for (const period of index.get(requirement.marketplace_name)?.coverage ?? []) {
      if (period.valid_to !== null && period.valid_to <= cursor) continue;
      if (period.valid_from >= requirement.valid_to) break;
      if (period.valid_from > cursor)
        gaps.push({ ...requirement, valid_from: cursor, valid_to: period.valid_from });
      if (period.valid_to === null || period.valid_to >= requirement.valid_to) return gaps;
      cursor = period.valid_to;
    }
    if (cursor < requirement.valid_to) gaps.push({ ...requirement, valid_from: cursor });
    return gaps;
  });
}
