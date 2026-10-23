export function lastPageIndex(totalCount: number, pageSize: number): number {
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1);
}

export function pageRangeSummary(
  pageIndex: number,
  pageSize: number,
  rowCount: number,
  totalCount: number | null,
  items: string,
): string {
  const first = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const last = rowCount === 0 ? 0 : pageIndex * pageSize + rowCount;
  return `${String(first)}–${String(last)} of ${totalCount?.toLocaleString("en-US") ?? "—"} ${items}`;
}
