import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanonicalRow } from "./api";
import type { Identity } from "./auth-session";
import { payoutHistoryQueryOptions, payoutVersionQueryOptions } from "./payout-report-queries";
import {
  payoutScopeKey,
  payoutVersionSelection,
  type PayoutHistoryState,
} from "./payout-report-view";
import { rowId } from "./view-model";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";

/** Keep report identity across list refreshes without persisting fetched financial values. */
export function usePayoutReportSelection({
  identity,
  rows,
  selectedRowId,
  history,
  setHistory,
  onSelect,
  restoreFocus,
}: {
  identity: Identity;
  rows: CanonicalRow[];
  selectedRowId: string | null;
  history: PayoutHistoryState;
  setHistory: Dispatch<SetStateAction<PayoutHistoryState>>;
  onSelect: (id: string | null) => void;
  restoreFocus: boolean;
}) {
  const client = useQueryClient();
  const selectedLatest = rows.find((row) => rowId(row) === selectedRowId) ?? null;
  const selectedScope =
    !selectedLatest && history.selected?.reportId === selectedRowId ? history.selected : null;
  const versionQuery = useQuery(payoutVersionQueryOptions(identity, selectedScope));
  const selected = selectedLatest ?? (selectedScope ? (versionQuery.data ?? null) : null);
  const { rememberOpener, restoreFocus: restoreSelectionFocus } = useDrawerFocusReturn({
    opened: selected !== null,
    enabled: restoreFocus,
  });
  const latestOnPage = selected
    ? rows.find((row) => payoutScopeKey(row) === payoutScopeKey(selected))
    : undefined;
  const latestQuery = useQuery({
    ...payoutHistoryQueryOptions(
      identity,
      selectedScope ?? { companyId: "", startDate: "", endDate: "", currency: null },
      0,
    ),
    enabled: selectedScope !== null && latestOnPage === undefined,
  });
  const latestForSelection =
    latestOnPage ?? (selectedScope ? latestQuery.data?.rows.at(0) : undefined);
  const selectedIsLatest =
    selected !== null &&
    latestForSelection !== undefined &&
    rowId(selected) === rowId(latestForSelection);

  function rememberVersion(row: CanonicalRow) {
    rememberOpener();
    const selection = payoutVersionSelection(row);
    client.setQueryData(payoutVersionQueryOptions(identity, selection).queryKey, row);
    setHistory((current) => ({ ...current, selected: selection }));
  }

  function selectReport(id: string | null) {
    const row = rows.find((report) => rowId(report) === id);
    if (row) rememberVersion(row);
    onSelect(id);
  }

  function selectVersion(row: CanonicalRow) {
    rememberVersion(row);
    onSelect(rowId(row));
  }

  return {
    selected,
    selectedScope,
    selectedIsLatest,
    latestForSelection,
    versionQuery,
    selectReport,
    selectVersion,
    restoreSelectionFocus,
  };
}
