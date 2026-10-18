import type { AppAccount } from "./api/types.ts";
import { isCurrency, isJsonObject, isUuid } from "./api/validation.ts";
import { requireCalendarDate } from "./api/filters.ts";
import {
  decodeWorkspaceTab,
  decodeDatasetView,
  decodeInventoryView,
} from "./workspace-view-codec.ts";
import { decodePayoutHistoryState } from "./payout-report-view.ts";
import { decodeReviewScope } from "./financial-review-view.ts";
import { reviewCategory } from "./financial-review-categories.ts";

import { withoutWorkspaceLocation } from "./workspace-location-cleanup.ts";

const TABLE_TABS = ["live", "finances", "data_kiosk", "payouts", "accounts"] as const;
type Preferences = ReadonlyMap<string, unknown>;

function date(value: string | null): string {
  if (!value) return "";
  try {
    requireCalendarDate(value);
    return value;
  } catch {
    return "";
  }
}

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
  if (name === "datasets" && TABLE_TABS.some((value) => value === tab)) {
    const dataset = tab as (typeof TABLE_TABS)[number];
    const views = isJsonObject(saved) ? saved : {};
    const view = decodeDatasetView(
      {
        search: p.get("search"),
        pagination: {
          pageIndex: Number(p.get("page") ?? 0),
          pageSize: Number(p.get("size") ?? 25),
        },
        sorting: [{ id: p.get("sort"), desc: p.get("order") !== "asc" }],
        selectedRowId: p.get("row"),
        filters: {
          marketplaces: p.getAll("marketplace"),
          types: p.getAll("type"),
          sources: p.getAll("source"),
          feeApplicability: p.getAll("fee"),
        },
      },
      dataset,
    );
    view.filters.dateFrom = date(p.get("from"));
    view.filters.dateTo = date(p.get("to"));
    view.filters.companyIds = p.getAll("company").filter(isUuid);
    view.filters.skus = p.getAll("sku").filter((sku) => sku.length <= 300 && !sku.includes("\0"));
    if (dataset === "payouts" && selected) view.selectedRowId = selected.reportId;
    return { ...views, [dataset]: view };
  }
  if (name === "inventory" && tab === "inventory") {
    const nullableValues = (key: string) =>
      p.getAll(key).flatMap((value) => {
        try {
          const decoded: unknown = JSON.parse(value);
          return decoded === null || typeof decoded === "string" ? [decoded] : [];
        } catch {
          return [];
        }
      });
    return decodeInventoryView({
      search: p.get("search"),
      marketplace: p.get("marketplace"),
      skus: nullableValues("sku"),
      healthStatuses: nullableValues("health"),
      recommendations: nullableValues("recommendation"),
      sortColumn: p.get("sort"),
      sortDirection: p.get("order"),
      pageIndex: Number(p.get("page") ?? 0),
      pageSize: Number(p.get("size") ?? 25),
      selectedRowId: p.get("row"),
    });
  }
  if (name === "payout-report-history" && tab === "payouts") {
    return { ...decodePayoutHistoryState(saved), selected };
  }
  if (tab !== "financial-review") return saved;
  const category = reviewCategory(p.get("category"));
  const scope = decodeReviewScope({ year: p.get("year"), currency: p.get("currency") });
  const month = date(`${p.get("month") ?? ""}-01`).slice(0, 7) || null;
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
  if (TABLE_TABS.some((value) => value === tab)) {
    const dataset = tab as (typeof TABLE_TABS)[number];
    const views = preferences.get("datasets");
    const view = decodeDatasetView(isJsonObject(views) ? views[dataset] : null, dataset);
    if (view.search) p.set("search", view.search);
    if (view.pagination.pageIndex) p.set("page", String(view.pagination.pageIndex));
    if (view.pagination.pageSize !== 25) p.set("size", String(view.pagination.pageSize));
    p.set("sort", view.sorting[0].id);
    p.set("order", view.sorting[0].desc ? "desc" : "asc");
    if (view.selectedRowId) p.set("row", view.selectedRowId);
    for (const [key, values] of [
      ["marketplace", view.filters.marketplaces],
      ["type", view.filters.types],
      ["source", view.filters.sources],
      ["fee", view.filters.feeApplicability],
    ] as const)
      for (const value of values) p.append(key, value);
    for (const [key, value] of [
      ["from", view.filters.dateFrom],
      ["to", view.filters.dateTo],
    ]) {
      if (date(value)) p.set(key, value);
    }
    for (const company of view.filters.companyIds.filter(isUuid)) p.append("company", company);
    for (const sku of view.filters.skus) p.append("sku", sku);
    if (tab === "live") {
      const currency = preferences.get("summary-currency");
      p.set("currency", isCurrency(currency) ? currency : "USD");
    }
    if (tab === "payouts") {
      const history = decodePayoutHistoryState(preferences.get("payout-report-history"));
      if (history.selected?.reportId === view.selectedRowId) selected = history.selected;
    }
  } else if (tab === "inventory") {
    const view = decodeInventoryView(preferences.get("inventory"));
    if (view.search) p.set("search", view.search);
    if (view.marketplace) p.set("marketplace", view.marketplace);
    if (view.pageIndex) p.set("page", String(view.pageIndex));
    if (view.pageSize !== 25) p.set("size", String(view.pageSize));
    p.set("sort", view.sortColumn);
    p.set("order", view.sortDirection);
    if (view.selectedRowId) p.set("row", view.selectedRowId);
    for (const [key, values] of [
      ["sku", view.skus],
      ["health", view.healthStatuses],
      ["recommendation", view.recommendations],
    ] as const) {
      for (const value of values) p.append(key, JSON.stringify(value));
    }
  } else if (tab === "financial-review") {
    const category = reviewCategory(preferences.get("financial-review:category"));
    const scope = decodeReviewScope(preferences.get("financial-review:scope"));
    const view = preferences.get(`financial-review:monthly-summaries:${category}`);
    const month =
      isJsonObject(view) && typeof view.selectedMonth === "string" ? view.selectedMonth : "";
    p.set("category", category);
    p.set("currency", scope.currency);
    if (scope.year) p.set("year", scope.year);
    if (date(`${month}-01`)) p.set("month", month);
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
