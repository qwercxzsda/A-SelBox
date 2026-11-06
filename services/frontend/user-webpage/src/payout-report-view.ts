import type { CanonicalRow } from "./api/types.ts";
import { isJsonObject } from "./api/validation.ts";
import { decodeDetailPage, decodeDetailStrings } from "./detail-view-state.ts";
import {
  decodePayoutVersionSelection,
  type PayoutVersionSelection,
} from "./payout-report-scope.ts";

export interface PayoutHistoryState {
  expanded: string[];
  pages: Record<string, number>;
  selected: PayoutVersionSelection | null;
}

export function createPayoutHistoryState(): PayoutHistoryState {
  return { expanded: [], pages: {}, selected: null };
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
