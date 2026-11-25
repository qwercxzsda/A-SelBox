import type { Company } from "./api/types.ts";
import { parseRecordTimestamp } from "./date-display.ts";
import { savedPageIndex, savedPageSize, savedText } from "./saved-values.ts";

const COMPANY_SORT_COLUMNS = ["name", "skus", "created"] as const;
export type CompanySortColumn = (typeof COMPANY_SORT_COLUMNS)[number];

/** Tabs whose editors offer Add company; Companies then offers a way back to them. */
export const COMPANY_RETURN_TABS = {
  fees: "Current fees",
  accounts: "User access",
  assignments: "Assignments",
} as const;
export type CompanyReturnTab = keyof typeof COMPANY_RETURN_TABS;

export function decodeCompanyReturnTab(value: unknown): CompanyReturnTab | null {
  return value === "fees" || value === "accounts" || value === "assignments" ? value : null;
}

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
    search: savedText(saved.search),
    pageSize: savedPageSize(saved.pageSize),
    pageIndex: savedPageIndex(saved.pageIndex),
    selected: savedText(saved.selected) || null,
    sortColumn: COMPANY_SORT_COLUMNS.find((column) => column === saved.sortColumn) ?? "name",
    sortDirection: saved.sortDirection === "desc" ? "desc" : "asc",
  };
}

/** A company just added has no saved timestamp until the catalog refreshes: it is the newest. */
function createdTime({ created_at }: Company): number {
  if (created_at === null) return Number.POSITIVE_INFINITY;
  const created = parseRecordTimestamp(created_at);
  if (!created) throw new Error("Company has an invalid created_at");
  return created.getTime();
}

function compareCompanies(
  left: Company,
  right: Company,
  sortColumn: CompanySortColumn,
  assignments: Map<string, string[]>,
): number {
  if (sortColumn === "skus")
    return (assignments.get(left.id)?.length ?? 0) - (assignments.get(right.id)?.length ?? 0);
  if (sortColumn === "created") {
    const [leftTime, rightTime] = [createdTime(left), createdTime(right)];
    return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

/**
 * The page that shows `company` once the list holds it. An existing company keeps its listed entry
 * and saved timestamp; only a company the list lacks (just created) is added.
 */
export function companyPageIndex(
  companies: readonly Company[],
  company: Company,
  assignments: Map<string, string[]>,
  state: Pick<CompanyListState, "sortColumn" | "sortDirection" | "pageSize">,
): number {
  const listed = companies.some(({ id }) => id === company.id)
    ? companies
    : [...companies, company];
  const index = orderCompanies(listed, assignments, state).findIndex(({ id }) => id === company.id);
  return Math.floor(index / state.pageSize);
}

export function orderCompanies(
  companies: readonly Company[],
  assignments: Map<string, string[]>,
  { sortColumn, sortDirection }: Pick<CompanyListState, "sortColumn" | "sortDirection">,
) {
  return [...companies].sort((left, right) => {
    const comparison = compareCompanies(left, right, sortColumn, assignments);
    return (
      (comparison ? (sortDirection === "desc" ? -comparison : comparison) : 0) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  });
}
