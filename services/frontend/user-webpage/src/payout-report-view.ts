import type { CanonicalRow } from "./api/types.ts";
import { requireDateRange } from "./api/filters.ts";
import { isCurrency, isJsonObject, isUuid } from "./api/validation.ts";
import { decodeDetailPage, decodeDetailStrings } from "./detail-view-state.ts";
import { isPayoutMarketplace, payoutMarketplace } from "./payout-report-scope.ts";

export function payoutScopeKey(row: CanonicalRow): string {
  return JSON.stringify([
    row.company_id,
    row.start_date,
    row.end_date,
    payoutMarketplace(row),
    row.currency,
  ]);
}

export interface PayoutHistoryState {
  expanded: string[];
  pages: Record<string, number>;
  selected: PayoutVersionSelection | null;
}

export interface PayoutVersionSelection {
  marketplaceName: string | null;
  companyId: string;
  startDate: string;
  endDate: string;
  currency: string | null;
  reportId: string;
}

export function payoutVersionSelection(row: CanonicalRow): PayoutVersionSelection {
  return {
    companyId: row.company_id ?? "",
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    currency: row.currency,
    marketplaceName: payoutMarketplace(row),
    reportId: row.id ?? "",
  };
}

export function createPayoutHistoryState(): PayoutHistoryState {
  return { expanded: [], pages: {}, selected: null };
}

function decodePayoutVersionSelection(value: unknown): PayoutVersionSelection | null {
  if (
    !isJsonObject(value) ||
    !isUuid(value.companyId) ||
    !isUuid(value.reportId) ||
    typeof value.startDate !== "string" ||
    !value.startDate ||
    typeof value.endDate !== "string" ||
    !value.endDate ||
    !(value.currency === null || isCurrency(value.currency)) ||
    !isPayoutMarketplace(value.marketplaceName)
  )
    return null;
  try {
    requireDateRange(value.startDate, value.endDate);
  } catch {
    return null;
  }
  return {
    companyId: value.companyId,
    startDate: value.startDate,
    endDate: value.endDate,
    currency: value.currency,
    reportId: value.reportId,
    marketplaceName: value.marketplaceName,
  };
}

/** Restore navigation and identity only; a report's amounts always come from the API. */
export function decodePayoutHistoryState(value: unknown): PayoutHistoryState {
  if (!isJsonObject(value)) return createPayoutHistoryState();
  return {
    expanded: decodeDetailStrings(value.expanded),
    pages: isJsonObject(value.pages)
      ? Object.fromEntries(
          Object.entries(value.pages).map(([key, page]) => [key, decodeDetailPage(page)]),
        )
      : {},
    selected: decodePayoutVersionSelection(value.selected),
  };
}

export function groupPayoutReports(rows: CanonicalRow[]) {
  const groups = new Map<string, CanonicalRow[]>();
  for (const row of rows) {
    const month = row.start_date ?? "";
    const group = groups.get(month);
    if (group) group.push(row);
    else groups.set(month, [row]);
  }
  return [...groups].map(([month, reports]) => ({ month, reports }));
}
