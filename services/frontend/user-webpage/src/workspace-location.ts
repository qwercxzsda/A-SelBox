import type { AppAccount } from "./api/types.ts";
import { isTableDataset } from "./api/config.ts";
import { isJsonObject } from "./api/validation.ts";
import {
  decodeWorkspaceTab,
  decodeDatasetView,
  decodeInventoryView,
} from "./workspace-view-codec.ts";
import { decodePayoutHistoryState } from "./payout-report-view.ts";
import { decodePayoutVersionSelection } from "./payout-report-scope.ts";
import { decodeOutcomeFilters } from "./outcome-filters.ts";
import { withoutWorkspaceLocation } from "./workspace-location-cleanup.ts";
import {
  readDatasetLocation,
  readInventoryLocation,
  writeDatasetLocation,
  writeInventoryLocation,
} from "./workspace-list-location.ts";

type Preferences = ReadonlyMap<string, unknown>;

function reportSelection(params: URLSearchParams) {
  const currency = params.get("reportCurrency");
  const marketplace = params.get("reportMarketplace");
  return decodePayoutVersionSelection({
    reportId: params.get("report"),
    companyId: params.get("reportCompany"),
    startDate: params.get("reportFrom"),
    endDate: params.get("reportTo"),
    currency: currency === "" ? null : (currency ?? undefined),
    marketplaceName: marketplace === "" ? null : (marketplace ?? undefined),
  });
}

/** Only read-only navigation is shareable. Drafts, tokens, amounts and access roles never enter URLs. */
export function locationPreference(
  url: URL,
  account: AppAccount,
  name: string,
  saved: unknown,
): unknown {
  if (!url.searchParams.has("tab")) return saved;
  const p = url.searchParams;
  const tab = decodeWorkspaceTab(p.get("tab"), account);
  const selected = reportSelection(p);
  if (name === "tab") return tab;
  if (name === "datasets" && isTableDataset(tab)) {
    const views = isJsonObject(saved) ? saved : {};
    const view = readDatasetLocation(p, tab);
    if (tab === "payouts") view.selectedRowId = selected?.reportId ?? null;
    return { ...views, [tab]: view };
  }
  if (name === "inventory" && tab === "inventory") {
    const view = readInventoryLocation(p);
    if (account.access_role !== "administrator") view.companyIds = [];
    return view;
  }
  if (name === "payout-report-history" && tab === "payouts") {
    return { ...decodePayoutHistoryState(saved), selected };
  }
  if (tab === "financial-review" && name === "financial-review:filters") {
    return decodeOutcomeFilters({
      view: p.get("outcome"),
      month: p.get("month"),
      marketplace: p.get("marketplace"),
    });
  }
  return saved;
}

export function workspaceLocation(url: URL, account: AppAccount, preferences: Preferences): URL {
  const next = withoutWorkspaceLocation(url);
  const p = next.searchParams;
  const tab = decodeWorkspaceTab(preferences.get("tab"), account);
  p.set("tab", tab);
  let selected = null;
  if (isTableDataset(tab)) {
    const views = preferences.get("datasets");
    const view = decodeDatasetView(isJsonObject(views) ? views[tab] : null, tab);
    writeDatasetLocation(p, view);
    if (tab === "payouts") {
      const history = decodePayoutHistoryState(preferences.get("payout-report-history"));
      if (history.selected?.reportId === view.selectedRowId) selected = history.selected;
      if (
        !preferences.has("payout-report-history") &&
        decodeWorkspaceTab(url.searchParams.get("tab"), account) === "payouts"
      ) {
        const incoming = reportSelection(url.searchParams);
        if (!preferences.has("datasets") || incoming?.reportId === view.selectedRowId)
          selected = incoming;
      }
    }
  } else if (tab === "inventory") {
    const view = decodeInventoryView(preferences.get("inventory"));
    if (account.access_role !== "administrator") view.companyIds = [];
    writeInventoryLocation(p, view);
  }
  if (tab === "financial-review") {
    const filters = decodeOutcomeFilters(
      preferences.get("financial-review:filters") ??
        locationPreference(url, account, "financial-review:filters", null),
    );
    p.set("outcome", filters.view);
    if (filters.month) p.set("month", filters.month);
    if (filters.marketplace) p.set("marketplace", filters.marketplace);
  }
  if (selected) {
    p.set("report", selected.reportId);
    p.set("reportCompany", selected.companyId);
    p.set("reportFrom", selected.startDate);
    p.set("reportTo", selected.endDate);
    p.set("reportCurrency", selected.currency ?? "");
    p.set("reportMarketplace", selected.marketplaceName ?? "");
  }
  return next;
}
