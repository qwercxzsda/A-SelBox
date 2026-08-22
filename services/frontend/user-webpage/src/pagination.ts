export function lastPageIndex(totalCount: number, pageSize: number): number {
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1);
}
