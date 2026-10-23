import type { AppAccount } from "./api/types.ts";
import { isTableDataset } from "./api/config.ts";
import { isCurrency, isJsonObject } from "./api/validation.ts";
import {
  decodeWorkspaceTab,
  decodeDatasetView,
  decodeInventoryView,
} from "./workspace-view-codec.ts";
import { decodePayoutHistoryState } from "./payout-report-view.ts";
import { decodeReviewScope } from "./financial-review-view.ts";
import { reviewCategory } from "./financial-review-categories.ts";
import { withoutWorkspaceLocation } from "./workspace-location-cleanup.ts";
import {
  locationDate,
  readDatasetLocation,
  readInventoryLocation,
  writeDatasetLocation,
  writeInventoryLocation,
} from "./workspace-list-location.ts";

type Preferences = ReadonlyMap<string, unknown>;

function reportSelection(params: URLSearchParams) {
  const currency = params.get("reportCurrency");
  return decodePayoutHistoryState({
    selected: {
      reportId: params.get("report"),
      companyId: params.get("reportCompany"),
      startDate: params.get("reportFrom"),
      endDate: params.get("reportTo"),
      currency: currency === "" ? null : currency,
    },
  }).selected;
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
  if (name === "summary-currency" && tab === "live")
    return isCurrency(p.get("currency")) ? p.get("currency") : "USD";
  if (name === "datasets" && isTableDataset(tab)) {
    const views = isJsonObject(saved) ? saved : {};
    const view = readDatasetLocation(p, tab);
    if (tab === "payouts" && selected) view.selectedRowId = selected.reportId;
    return { ...views, [tab]: view };
  }
  if (name === "inventory" && tab === "inventory") return readInventoryLocation(p);
  if (name === "payout-report-history" && tab === "payouts") {
    return { ...decodePayoutHistoryState(saved), selected };
  }
  if (tab !== "financial-review") return saved;
  const category = reviewCategory(p.get("category"));
  const scope = decodeReviewScope({ year: p.get("year"), currency: p.get("currency") });
  const month = locationDate(`${p.get("month") ?? ""}-01`).slice(0, 7) || null;
  const scopedReport =
    selected?.currency === scope.currency && selected.startDate === `${month ?? ""}-01`
      ? selected
      : null;
  if (name === "financial-review:category") return category;
  if (name === "financial-review:scope") return scope;
  if (name === `financial-review:monthly-summaries:${category}`) return { selectedMonth: month };
  if (month !== null && name === `financial-review:snapshots:${month}:${scope.currency}`) {
    return {
      ...decodeDatasetView(saved, "payouts"),
      selectedRowId: scopedReport?.reportId ?? null,
    };
  }
  if (month !== null && name === `payout-review-history:${month}-01:${scope.currency}`) {
    return { ...decodePayoutHistoryState(saved), selected: scopedReport };
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
    if (tab === "live") {
      const currency = preferences.get("summary-currency");
      p.set("currency", isCurrency(currency) ? currency : "USD");
    }
    if (tab === "payouts") {
      const history = decodePayoutHistoryState(preferences.get("payout-report-history"));
      if (history.selected?.reportId === view.selectedRowId) selected = history.selected;
    }
  } else if (tab === "inventory") {
    writeInventoryLocation(p, decodeInventoryView(preferences.get("inventory")));
  } else if (tab === "financial-review") {
    const category = reviewCategory(preferences.get("financial-review:category"));
    const scope = decodeReviewScope(preferences.get("financial-review:scope"));
    const view = preferences.get(`financial-review:monthly-summaries:${category}`);
    const month =
      isJsonObject(view) && typeof view.selectedMonth === "string" ? view.selectedMonth : "";
    p.set("category", category);
    p.set("currency", scope.currency);
    if (scope.year) p.set("year", scope.year);
    if (locationDate(`${month}-01`)) p.set("month", month);
    const snapshotKey = `financial-review:snapshots:${month}:${scope.currency}`;
    const snapshot = decodeDatasetView(preferences.get(snapshotKey), "payouts");
    const history = decodePayoutHistoryState(
      preferences.get(`payout-review-history:${month}-01:${scope.currency}`),
    );
    if (history.selected?.reportId === snapshot.selectedRowId) selected = history.selected;
    // Nested snapshots mount only after monthly data loads. Do not discard their
    // incoming deep-link identity while those parent queries are still pending.
    if (!preferences.has(snapshotKey) && url.searchParams.get("month") === month) {
      const incoming = reportSelection(url.searchParams);
      if (incoming?.currency === scope.currency && incoming.startDate === `${month}-01`)
        selected = incoming;
    }
  }
  if (selected) {
    p.set("report", selected.reportId);
    p.set("reportCompany", selected.companyId);
    p.set("reportFrom", selected.startDate);
    p.set("reportTo", selected.endDate);
    p.set("reportCurrency", selected.currency ?? "");
  }
  return next;
}
