import { lastPageIndex } from "./pagination.ts";
import { companyLabel } from "./view-model.ts";

// Lists loaded once (Current fees, Assignments) search, filter and page in the browser, so their
// totals are always exact.

/** Exact code-unit order keeps spelling variants of one identifier distinct and stable. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Literal, case-insensitive search on each item's identifier and, when company names are given
 * (administrators), its company. The result is sorted by the identifier; ties keep their order.
 */
export function searchLocalList<Item>(
  items: readonly Item[],
  search: string,
  identifier: (item: Item) => string,
  company?: { id: (item: Item) => string | null; names: Map<string, string> },
): Item[] {
  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  return items
    .filter(
      (item) =>
        matches(identifier(item)) ||
        (company !== undefined && matches(companyLabel(company.id(item), company.names))),
    )
    .sort((left, right) => compareText(identifier(left), identifier(right)));
}

/** One page with exact totals; a page beyond the end (after a filter shrinks it) clamps. */
export function paginateLocalList<Item>(
  items: readonly Item[],
  pageIndex: number,
  pageSize: number,
) {
  const finalPage = lastPageIndex(items.length, pageSize);
  const currentPage = Math.max(0, Math.min(pageIndex, finalPage));
  const start = currentPage * pageSize;
  return {
    visibleItems: items.slice(start, start + pageSize),
    pageIndex: currentPage,
    pageCount: finalPage + 1,
    totalCount: items.length,
  };
}

/** An empty selection matches every row; otherwise any of the row's values must be selected. */
export function matchesSelection<Value>(
  selected: readonly Value[],
  values: readonly Value[],
): boolean {
  return selected.length === 0 || values.some((value) => selected.includes(value));
}
