import type { SkuAssignment } from "./api/types.ts";
import { lastPageIndex } from "./pagination.ts";
import { companyLabel } from "./view-model.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Each exact SKU has one assignment; omit company names for member searches. */
export function filterFeeSkus(
  assignments: readonly SkuAssignment[],
  search: string,
  companies?: Map<string, string>,
): SkuAssignment[] {
  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  return assignments
    .filter(
      (assignment) =>
        matches(assignment.sku) ||
        (companies !== undefined && matches(companyLabel(assignment.company_id, companies))),
    )
    .sort((left, right) => compareText(left.sku, right.sku));
}

export function paginateFeeSkus(assignments: SkuAssignment[], pageIndex: number, pageSize: number) {
  const finalPage = lastPageIndex(assignments.length, pageSize);
  const currentPage = Math.max(0, Math.min(pageIndex, finalPage));
  const start = currentPage * pageSize;
  const visibleSkus = assignments.slice(start, start + pageSize);
  return {
    visibleSkus,
    pageIndex: currentPage,
    pageCount: finalPage + 1,
    totalCount: assignments.length,
    firstVisible: assignments.length === 0 ? 0 : start + 1,
    lastVisible: start + visibleSkus.length,
  };
}
