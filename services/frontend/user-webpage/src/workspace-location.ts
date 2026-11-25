import type { AppAccount } from "./api/types.ts";
import { isTableDataset } from "./api/config.ts";
import { isJsonObject } from "./api/validation.ts";
import {
  decodeWorkspaceTab,
  decodeDatasetView,
  decodeFeeView,
  decodeInventoryView,
} from "./workspace-view-codec.ts";
import { decodeCompanyList } from "./companies-view.ts";
import {
  decodeAssignmentList,
  memberAssignmentList,
  readAssignmentLocation,
  writeAssignmentLocation,
  type AssignmentListState,
} from "./assignments-view.ts";
import { decodePayoutHistoryState } from "./payout-report-view.ts";
import { decodePayoutVersionSelection } from "./payout-report-scope.ts";
import { decodeFinancialReviewView } from "./financial-review-view.ts";
import { withoutWorkspaceLocation } from "./workspace-location-cleanup.ts";
import { decodeRawDataset } from "./raw-data-view.ts";
import {
  readDatasetLocation,
  readInventoryLocation,
  writeDatasetLocation,
  writeInventoryLocation,
} from "./workspace-list-location.ts";

type Preferences = ReadonlyMap<string, unknown>;

function memberScoped(account: AppAccount, view: AssignmentListState): AssignmentListState {
  return account.access_role === "administrator" ? view : memberAssignmentList(view);
}

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
  // Raw data names its open sub-tab in `raw=`; that sub-tab's list uses the dataset parameters.
  const listed =
    tab === "raw-data" ? decodeRawDataset(p.get("raw")) : isTableDataset(tab) ? tab : null;
  if (name === "raw-data:dataset" && tab === "raw-data") return listed;
  if (name === "datasets" && listed) {
    const views = isJsonObject(saved) ? saved : {};
    const view = readDatasetLocation(p, listed);
    if (listed === "payouts") view.selectedRowId = selected?.reportId ?? null;
    return { ...views, [listed]: view };
  }
  if (name === "inventory" && tab === "inventory") {
    const view = readInventoryLocation(p);
    if (account.access_role !== "administrator") view.companyIds = [];
    return view;
  }
  if (name === "payout-report-history" && tab === "payouts") {
    return { ...decodePayoutHistoryState(saved), selected };
  }
  // Current fees and Companies keep only the open row in the URL; drafts stay in preferences.
  if (name === "fees" && tab === "fees")
    return { ...(isJsonObject(saved) ? saved : {}), selectedSku: p.get("row") };
  if (name === "companies:list" && tab === "companies")
    return { ...(isJsonObject(saved) ? saved : {}), selected: p.get("row") };
  if (name === "assignments:list" && tab === "assignments")
    return memberScoped(account, readAssignmentLocation(p, saved));
  if (tab === "financial-review" && name === "financial-review:view") {
    return decodeFinancialReviewView({
      marketplace: p.get("marketplace"),
      year: p.get("year"),
      month: p.get("row"),
      reason: p.get("reason"),
      selboxGroup: p.get("group"),
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
  } else if (tab === "fees") {
    const row = decodeFeeView(
      preferences.get("fees") ?? locationPreference(url, account, "fees", null),
    ).selectedSku;
    if (row) p.set("row", row);
  } else if (tab === "companies") {
    const row = decodeCompanyList(
      preferences.get("companies:list") ?? locationPreference(url, account, "companies:list", null),
    ).selected;
    if (row) p.set("row", row);
  } else if (tab === "assignments") {
    const view = decodeAssignmentList(
      preferences.get("assignments:list") ??
        locationPreference(url, account, "assignments:list", null),
    );
    writeAssignmentLocation(p, memberScoped(account, view));
  }
  if (tab === "raw-data") {
    const raw = decodeRawDataset(
      preferences.get("raw-data:dataset") ??
        locationPreference(url, account, "raw-data:dataset", null),
    );
    const views = preferences.get("datasets");
    p.set("raw", raw);
    writeDatasetLocation(p, decodeDatasetView(isJsonObject(views) ? views[raw] : null, raw));
  }
  if (tab === "financial-review") {
    const review = decodeFinancialReviewView(
      preferences.get("financial-review:view") ??
        locationPreference(url, account, "financial-review:view", null),
    );
    p.set("marketplace", review.marketplace);
    p.set("year", String(review.year));
    if (review.month) p.set("row", review.month);
    if (review.reason) p.set("reason", review.reason);
    if (review.selboxGroup) p.set("group", review.selboxGroup);
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
