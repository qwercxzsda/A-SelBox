import { useEffect, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { CanonicalRow, PageResult } from "./api/types";
import type { Identity } from "./auth-session";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { payoutHistoryQueryOptions } from "./payout-report-queries";
import { payoutScopeKey, payoutVersionSelection } from "./payout-report-scope";
import type { PayoutHistoryState } from "./payout-report-view";
import { rowId } from "./view-model";

export interface PayoutReportHistoryPage {
  query: UseQueryResult<PageResult>;
  rows: CanonicalRow[];
  loadedCount: number;
  total: number | null;
  pageIndex: number;
  pageCount: number | null;
  showPagination: boolean;
  showControls: boolean;
  rowCount: number;
}

/** Resolve expanded history before rendering so month row spans include every native row. */
export function usePayoutReportHistories(
  identity: Identity,
  rows: CanonicalRow[],
  history: PayoutHistoryState,
  onPageChange: (key: string, page: number) => void,
) {
  const expanded = useMemo(
    () => rows.filter((row) => history.expanded.includes(payoutScopeKey(row))),
    [rows, history.expanded],
  );
  const queries = useQueries({
    queries: expanded.map((row) =>
      payoutHistoryQueryOptions(
        identity,
        payoutVersionSelection(row),
        history.pages[payoutScopeKey(row)] ?? 0,
      ),
    ),
  });
  const pages = useMemo(() => {
    const pages = new Map<string, PayoutReportHistoryPage>();
    expanded.forEach((latest, index) => {
      const key = payoutScopeKey(latest);
      const query = queries[index];
      const pageIndex = history.pages[key] ?? 0;
      const loaded = query.data?.rows ?? [];
      const previous = loaded.filter((row) => rowId(row) !== rowId(latest));
      const total = query.data?.totalCount ?? null;
      const pageCount = total === null ? null : Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));
      const showPagination =
        pageIndex > 0 ||
        (total !== null && total > DETAIL_PAGE_SIZE) ||
        (query.isSuccess && total === null);
      const showControls =
        query.isPending || query.isError || previous.length === 0 || showPagination;
      pages.set(key, {
        query,
        rows: previous,
        loadedCount: loaded.length,
        total,
        pageIndex,
        pageCount,
        showPagination,
        showControls,
        rowCount: previous.length + Number(showControls),
      });
    });
    return pages;
  }, [expanded, queries, history.pages]);
  useEffect(() => {
    for (const [key, page] of pages)
      if (page.query.isSuccess && page.pageCount !== null && page.pageIndex >= page.pageCount)
        onPageChange(key, page.pageCount - 1);
  }, [pages, onPageChange]);
  return pages;
}
