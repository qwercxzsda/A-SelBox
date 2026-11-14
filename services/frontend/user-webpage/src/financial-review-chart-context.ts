import type { ReviewChartFamily } from "./financial-review-chart.ts";

type FamilyContext = Pick<ReviewChartFamily, "comparisonKind" | "unpairedSource">;

/** Comparable scopes precede basis differences and unpaired coverage, regardless of amount. */
export function chartFamilyScopeOrder(family: FamilyContext | undefined): number {
  if (family?.comparisonKind === "paired") return 0;
  if (family?.comparisonKind === "different-basis") return 1;
  return 2;
}

export function chartFamilyScopeLabel(family: FamilyContext | undefined): string | null {
  if (family?.comparisonKind === "different-basis") return "Different reporting basis";
  if (family?.comparisonKind === "unpaired") {
    const source = family.unpairedSource;
    return source ? `Unpaired amount (${source})` : "Unpaired amount";
  }
  return null;
}
