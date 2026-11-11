import type { TableDatasetKey } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { isUuid } from "./api/validation.ts";
import { decodeDatasetView, decodeInventoryView } from "./workspace-view-codec.ts";
import type { DatasetViewState, InventoryViewState } from "./workspace-view-state.ts";
import { PAGE_SIZES } from "./view-model.ts";

export function locationDate(value: string | null): string {
  if (!value) return "";
  try {
    requireCalendarDate(value);
    return value;
  } catch {
    return "";
  }
}

export function readDatasetLocation(params: URLSearchParams, dataset: TableDatasetKey) {
  const view = decodeDatasetView(
    {
      search: params.get("search"),
      pagination: {
        pageIndex: Number(params.get("page") ?? 0),
        pageSize: Number(params.get("size") ?? PAGE_SIZES[0]),
      },
      sorting: [{ id: params.get("sort"), desc: params.get("order") !== "asc" }],
      selectedRowId: params.get("row"),
      filters: {
        marketplaces: params.getAll("marketplace"),
        types: params.getAll("type"),
        sources: params.getAll("source"),
        feeApplicability: params.getAll("fee"),
      },
    },
    dataset,
  );
  view.filters.dateFrom = locationDate(params.get("from"));
  view.filters.dateTo = locationDate(params.get("to"));
  view.filters.companyIds = params.getAll("company").filter(isUuid);
  view.filters.skus = params
    .getAll("sku")
    .filter((sku) => sku.length <= 300 && !sku.includes("\0"));
  return view;
}

function writeListPosition(
  params: URLSearchParams,
  view: Pick<InventoryViewState, "search" | "pageIndex" | "pageSize" | "selectedRowId">,
) {
  if (view.search) params.set("search", view.search);
  if (view.pageIndex) params.set("page", String(view.pageIndex));
  if (view.pageSize !== PAGE_SIZES[0]) params.set("size", String(view.pageSize));
  if (view.selectedRowId) params.set("row", view.selectedRowId);
}

export function writeDatasetLocation(params: URLSearchParams, view: DatasetViewState) {
  writeListPosition(params, { ...view, ...view.pagination });
  params.set("sort", view.sorting[0].id);
  params.set("order", view.sorting[0].desc ? "desc" : "asc");
  for (const [key, values] of [
    ["marketplace", view.filters.marketplaces],
    ["type", view.filters.types],
    ["source", view.filters.sources],
    ["fee", view.filters.feeApplicability],
    ["company", view.filters.companyIds.filter(isUuid)],
    ["sku", view.filters.skus],
  ] as const)
    for (const value of values) params.append(key, value);
  for (const [key, value] of [
    ["from", view.filters.dateFrom],
    ["to", view.filters.dateTo],
  ])
    if (locationDate(value)) params.set(key, value);
}

function nullableValues(params: URLSearchParams, key: string): (string | null)[] {
  return params.getAll(key).flatMap((value) => {
    try {
      const decoded: unknown = JSON.parse(value);
      return decoded === null || typeof decoded === "string" ? [decoded] : [];
    } catch {
      return [];
    }
  });
}

export function readInventoryLocation(params: URLSearchParams) {
  return decodeInventoryView({
    search: params.get("search"),
    marketplaces: params.getAll("marketplace"),
    companyIds: nullableValues(params, "company"),
    skus: nullableValues(params, "sku"),
    healthStatuses: nullableValues(params, "health"),
    recommendations: nullableValues(params, "recommendation"),
    sortColumn: params.get("sort"),
    sortDirection: params.get("order"),
    pageIndex: Number(params.get("page") ?? 0),
    pageSize: Number(params.get("size") ?? PAGE_SIZES[0]),
    selectedRowId: params.get("row"),
  });
}

export function writeInventoryLocation(params: URLSearchParams, view: InventoryViewState) {
  writeListPosition(params, view);
  for (const marketplace of view.marketplaces) params.append("marketplace", marketplace);
  params.set("sort", view.sortColumn);
  params.set("order", view.sortDirection);
  for (const [key, values] of [
    ["sku", view.skus],
    ["company", view.companyIds],
    ["health", view.healthStatuses],
    ["recommendation", view.recommendations],
  ] as const)
    for (const value of values) params.append(key, JSON.stringify(value));
}
