import type { SkuAssignment } from "./api/types.ts";
import { lastPageIndex } from "./pagination.ts";
import { companyLabel } from "./view-model.ts";

export interface FeeSkuGroup {
  sku: string;
  assignments: SkuAssignment[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** SKU spelling is identity; whitespace, case and Unicode variants stay distinct. */
export function groupFeeSkus(assignments: readonly SkuAssignment[]): FeeSkuGroup[] {
  const groups = new Map<string, FeeSkuGroup>();
  for (const assignment of assignments) {
    const group = groups.get(assignment.sku);
    if (group) group.assignments.push(assignment);
    else groups.set(assignment.sku, { sku: assignment.sku, assignments: [assignment] });
  }
  for (const group of groups.values()) {
    group.assignments.sort((left, right) => compareText(left.id, right.id));
  }
  return [...groups.values()].sort((left, right) => compareText(left.sku, right.sku));
}

export function feeSkuCompanyLabels(group: FeeSkuGroup, companies: Map<string, string>): string[] {
  return [...new Set(group.assignments.map((row) => companyLabel(row.company_id, companies)))].sort(
    compareText,
  );
}

/** Company matching selects the whole SKU; omit company names for member searches. */
export function filterFeeSkuGroups(
  groups: FeeSkuGroup[],
  search: string,
  companies?: Map<string, string>,
): FeeSkuGroup[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return groups;
  return groups.filter((group) =>
    [group.sku, ...(companies ? feeSkuCompanyLabels(group, companies) : [])].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
}

export function paginateFeeSkuGroups(groups: FeeSkuGroup[], pageIndex: number, pageSize: number) {
  const finalPage = lastPageIndex(groups.length, pageSize);
  const currentPage = Math.max(0, Math.min(pageIndex, finalPage));
  const start = currentPage * pageSize;
  const visibleGroups = groups.slice(start, start + pageSize);
  return {
    visibleGroups,
    pageIndex: currentPage,
    pageCount: finalPage + 1,
    totalCount: groups.length,
    firstVisible: groups.length === 0 ? 0 : start + 1,
    lastVisible: start + visibleGroups.length,
  };
}
