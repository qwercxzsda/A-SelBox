import marketplaceOptions from "./generated/marketplaces.json" with { type: "json" };
import type { MarketplaceSummary } from "./summary-types.ts";

/** Empty filter selection means every marketplace, including those without records. */
export function summaryMarketplaces(selected: readonly string[]): string[] {
  return [...new Set(selected.length > 0 ? selected : marketplaceOptions)].sort();
}

const ACTIVITY_PRIORITY = ["selected", "month", "day"] as const;

/** Sort every card together by record presence, never monetary values or record volume. */
export function sortMarketplaceSummaries(
  groups: readonly MarketplaceSummary[],
): MarketplaceSummary[] {
  return [...groups].sort((left, right) => {
    for (const period of ACTIVITY_PRIORITY) {
      const leftHasRecords = left[period].some((total) => total.rowCount > 0);
      const rightHasRecords = right[period].some((total) => total.rowCount > 0);
      if (leftHasRecords !== rightHasRecords) return leftHasRecords ? -1 : 1;
    }
    return left.marketplace.localeCompare(right.marketplace, "en");
  });
}
