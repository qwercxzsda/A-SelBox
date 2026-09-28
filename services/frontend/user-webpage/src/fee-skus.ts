import { lastPageIndex } from "./pagination.ts";
import { companyLabel } from "./view-model.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Search exact-SKU configurations; omit company names for member searches. */
export function filterFeeSkus<Item extends { sku: string; company_id: string | null }>(
  items: readonly Item[],
  search: string,
  companies?: Map<string, string>,
): Item[] {
  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  return items
    .filter(
      (assignment) =>
        matches(assignment.sku) ||
        (companies !== undefined && matches(companyLabel(assignment.company_id, companies))),
    )
    .sort((left, right) => compareText(left.sku, right.sku));
}

export function paginateFeeSkus<Item>(items: Item[], pageIndex: number, pageSize: number) {
  const finalPage = lastPageIndex(items.length, pageSize);
  const currentPage = Math.max(0, Math.min(pageIndex, finalPage));
  const start = currentPage * pageSize;
  const visibleSkus = items.slice(start, start + pageSize);
  return {
    visibleSkus,
    pageIndex: currentPage,
    pageCount: finalPage + 1,
    totalCount: items.length,
    firstVisible: items.length === 0 ? 0 : start + 1,
    lastVisible: start + visibleSkus.length,
  };
}
