import type { AppAccount } from "./api/types.ts";
import { isTableDataset } from "./api/config.ts";
import { isCurrency, isJsonObject } from "./api/validation.ts";
import {
  decodeWorkspaceTab,
  decodeDatasetView,
  decodeInventoryView,
} from "./workspace-view-codec.ts";
import { decodePayoutHistoryState } from "./payout-report-view.ts";
import {
  decodePayoutVersionSelection,
  type PayoutVersionSelection,
} from "./payout-report-scope.ts";
import { decodeReviewScope, type ReviewScope } from "./financial-review-view.ts";
import { reviewPeriodKey } from "./financial-review-scope-key.ts";
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

function readReviewScope(params: URLSearchParams) {
  return decodeReviewScope({
    year: params.get("year"),
    marketplace: params.get("reviewMarketplace"),
    currency: params.get("currency"),
    families: params.getAll("family"),
  });
}

function reportInReviewPeriod(
  selected: PayoutVersionSelection | null,
  month: string,
  scope: ReviewScope,
): selected is PayoutVersionSelection {
  if (selected?.startDate !== `${month}-01`) return false;
  return (
    selected.marketplaceName === scope.marketplace &&
    (!scope.currency || selected.currency === scope.currency)
  );
}

function reviewPreferencePeriod(name: string, month: string, scope: ReviewScope) {
  for (const [prefix, kind] of [
    ["financial-review:snapshots:", "snapshots"],
    ["payout-review-history:", "history"],
  ] as const) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
    try {
      const parts: unknown = JSON.parse(key);
      if (!Array.isArray(parts)) return null;
      const currency: unknown = parts[2];
      if (
        !(currency === "" || isCurrency(currency)) ||
        (scope.currency !== "" && currency !== scope.currency) ||
        key !== reviewPeriodKey(month, scope.marketplace, currency)
      )
        return null;
      // An automatic unit may resolve before its URL update. The mounted key
      // supplies that actual unit; marketplace and explicit units still match.
      return { kind, scope: { ...scope, currency } };
    } catch {
      return null;
    }
  }
  return null;
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
    if (tab === "payouts") view.selectedRowId = selected?.reportId ?? null;
    return { ...views, [tab]: view };
  }
  if (name === "inventory" && tab === "inventory") return readInventoryLocation(p);
  if (name === "payout-report-history" && tab === "payouts") {
    return { ...decodePayoutHistoryState(saved), selected };
  }
  if (tab !== "financial-review") return saved;
  const category = reviewCategory(p.get("category"));
  const scope = readReviewScope(p);
  const month = locationDate(`${p.get("month") ?? ""}-01`).slice(0, 7) || null;
  if (name === "financial-review:category") return category;
  if (name === "financial-review:scope") return scope;
  if (name === `financial-review:monthly-summaries:${category}`) return { selectedMonth: month };
  const period = month === null ? null : reviewPreferencePeriod(name, month, scope);
  if (period === null) return saved;
  const scopedReport = reportInReviewPeriod(selected, month ?? "", period.scope) ? selected : null;
  if (period.kind === "snapshots") {
    return {
      ...decodeDatasetView(saved, "payouts"),
      selectedRowId: scopedReport?.reportId ?? null,
    };
  }
  return { ...decodePayoutHistoryState(saved), selected: scopedReport };
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
    writeInventoryLocation(p, decodeInventoryView(preferences.get("inventory")));
  } else if (tab === "financial-review") {
    const category = reviewCategory(preferences.get("financial-review:category"));
    const scope = decodeReviewScope(preferences.get("financial-review:scope"));
    const view = preferences.get(`financial-review:monthly-summaries:${category}`);
    const month =
      isJsonObject(view) && typeof view.selectedMonth === "string" ? view.selectedMonth : "";
    // Opening a month records its actual unit in the same user action. Keep
    // automatic scope automatic until that action, without an extra history entry.
    const currency =
      scope.currency ||
      (month && isJsonObject(view) && isCurrency(view.currency) ? view.currency : "");
    const periodScope = { ...scope, currency };
    p.set("category", category);
    p.set("reviewMarketplace", scope.marketplace);
    if (currency) p.set("currency", currency);
    if (scope.year) p.set("year", scope.year);
    for (const family of scope.families) p.append("family", family);
    if (locationDate(`${month}-01`)) p.set("month", month);
    const periodKey = reviewPeriodKey(month, scope.marketplace, currency);
    const snapshotKey = `financial-review:snapshots:${periodKey}`;
    const snapshot = decodeDatasetView(preferences.get(snapshotKey), "payouts");
    const history = decodePayoutHistoryState(preferences.get(`payout-review-history:${periodKey}`));
    if (
      history.selected?.reportId === snapshot.selectedRowId &&
      reportInReviewPeriod(history.selected, month, periodScope)
    )
      selected = history.selected;
    // Nested snapshots mount only after monthly data loads. Do not discard their
    // incoming deep-link identity while those parent queries are still pending.
    const incomingScope = readReviewScope(url.searchParams);
    const samePeriod =
      url.searchParams.get("month") === month &&
      incomingScope.marketplace === scope.marketplace &&
      (!incomingScope.currency || incomingScope.currency === currency);
    if (!preferences.has(snapshotKey) && samePeriod) {
      const incoming = reportSelection(url.searchParams);
      if (reportInReviewPeriod(incoming, month, periodScope)) selected = incoming;
    }
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
