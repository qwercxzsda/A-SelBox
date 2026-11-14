import type { Company } from "./api/types.ts";
import { PAGE_SIZES } from "./view-model.ts";

export type CompanySortColumn = "name" | "skus";

export interface CompanyListState {
  search: string;
  pageSize: number;
  pageIndex: number;
  selected: string | null;
  sortColumn: CompanySortColumn;
  sortDirection: "asc" | "desc";
}

export function decodeCompanyList(value: unknown): CompanyListState {
  const saved =
    typeof value === "object" && value !== null ? (value as Partial<CompanyListState>) : {};
  return {
    search: typeof saved.search === "string" ? saved.search : "",
    pageSize: PAGE_SIZES.find((size) => size === saved.pageSize) ?? PAGE_SIZES[0],
    pageIndex:
      typeof saved.pageIndex === "number" && Number.isSafeInteger(saved.pageIndex)
        ? Math.max(0, saved.pageIndex)
        : 0,
    selected: typeof saved.selected === "string" && saved.selected.length ? saved.selected : null,
    sortColumn: saved.sortColumn === "skus" ? "skus" : "name",
    sortDirection: saved.sortDirection === "desc" ? "desc" : "asc",
  };
}

export function orderCompanies(
  companies: readonly Company[],
  assignments: Map<string, string[]>,
  { sortColumn, sortDirection }: Pick<CompanyListState, "sortColumn" | "sortDirection">,
) {
  return [...companies].sort((left, right) => {
    const comparison =
      sortColumn === "skus"
        ? (assignments.get(left.id)?.length ?? 0) - (assignments.get(right.id)?.length ?? 0)
        : left.name.localeCompare(right.name);
    return (
      (comparison ? (sortDirection === "desc" ? -comparison : comparison) : 0) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  });
}
