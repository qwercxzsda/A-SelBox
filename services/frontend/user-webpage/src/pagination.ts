/** What each list counts, plural to singular. */
const SINGULAR = new Map([
  ["aged storage fees", "aged storage fee"],
  ["assignments", "assignment"],
  ["breakdowns", "breakdown"],
  ["companies", "company"],
  ["inventory items", "inventory item"],
  ["invoices", "invoice"],
  ["latest reports", "latest report"],
  ["records", "record"],
  ["removal order lines", "removal order line"],
  ["saved versions", "saved version"],
  ["SKUs", "SKU"],
  ["storage fees", "storage fee"],
  ["transactions", "transaction"],
  ["types", "type"],
  ["users", "user"],
]);

/** The noun for a count; an unknown noun is a programming error. */
function noun(items: string, count: number | null): string {
  const singular = SINGULAR.get(items);
  if (singular === undefined) throw new Error(`No singular form for "${items}".`);
  return count === 1 ? singular : items;
}

/** "1 record", "2 records". */
export function countLabel(count: number, items: string): string {
  return `${count.toLocaleString("en-US")} ${noun(items, count)}`;
}

export function lastPageIndex(totalCount: number, pageSize: number): number {
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1);
}

/** "1–25 of 120 users", "26 of 26 users" for one shown row, and "1 user" or "0 users" for all of them. */
export function pageRangeSummary(
  pageIndex: number,
  pageSize: number,
  rowCount: number,
  totalCount: number | null,
  items: string,
): string {
  if (totalCount !== null && totalCount <= 1 && rowCount === totalCount)
    return countLabel(totalCount, items);
  const first = pageIndex * pageSize + 1;
  const range =
    rowCount === 0
      ? "0"
      : rowCount === 1
        ? String(first)
        : `${String(first)}–${String(first + rowCount - 1)}`;
  return `${range} of ${totalCount === null ? `— ${noun(items, null)}` : countLabel(totalCount, items)}`;
}

/** Paging below a list appears once the list is long or a later page is shown. */
export function showsBottomPager(rowCount: number, pageIndex: number): boolean {
  return rowCount > 10 || pageIndex > 0;
}
