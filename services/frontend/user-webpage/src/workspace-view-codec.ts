import { INVENTORY_HEALTH_VALUES, INVENTORY_RECOMMENDATION_VALUES } from "./inventory-options.ts";
import { DATASET_CONFIG } from "./api/config.ts";
import type { AppAccount, DatasetKey, TableDatasetKey } from "./api/types.ts";
import type {
  SkuConfigurationChange,
  SkuConfigurationPeriod,
} from "./api/sku-configuration-types.ts";
import { INVENTORY_SORT_COLUMNS } from "./inventory-view.ts";
import { isJsonObject, isUuid } from "./api/validation.ts";
import { PAGE_SIZES, visibleDatasets } from "./view-model.ts";
import { normalizeDatasetFilters } from "./dataset-filters.ts";
import {
  createDatasetViewState,
  createFeeViewState,
  createInventoryViewState,
  type DatasetViewState,
  type FeeViewState,
  type InventoryViewState,
} from "./workspace-view-state.ts";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 10000 && !value.includes("\0");
const text = (value: unknown) => (isText(value) ? value : "");
const nullableText = (value: unknown) => (isText(value) ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isText).slice(0, 10000) : [];
const optionalStrings = (value: unknown): (string | null)[] =>
  Array.isArray(value)
    ? value.filter((item): item is string | null => item === null || isText(item)).slice(0, 10000)
    : [];
const pageIndex = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const pageSize = (value: unknown) => PAGE_SIZES.find((size) => size === value) ?? PAGE_SIZES[0];

export function decodeWorkspaceTab(
  value: unknown,
  account: AppAccount,
): DatasetKey | "inventory" | "financial-review" | "companies" {
  if (
    (value === "financial-review" || value === "companies") &&
    account.access_role === "administrator"
  )
    return value;
  return value === "inventory"
    ? value
    : (visibleDatasets(account).find((key) => key === value) ?? "live");
}

export function decodeDatasetView(value: unknown, dataset: TableDatasetKey): DatasetViewState {
  const fallback = createDatasetViewState(dataset);
  if (!isJsonObject(value)) return fallback;
  const pagination = isJsonObject(value.pagination) ? value.pagination : {};
  const sort =
    Array.isArray(value.sorting) && isJsonObject(value.sorting[0]) ? value.sorting[0] : {};
  const sortColumns: readonly string[] = DATASET_CONFIG[dataset].sortColumns;
  const filters = isJsonObject(value.filters) ? value.filters : {};
  return {
    search: text(value.search),
    pagination: {
      pageIndex: pageIndex(pagination.pageIndex),
      pageSize: pageSize(pagination.pageSize),
    },
    sorting:
      typeof sort.id === "string" && sortColumns.includes(sort.id) && typeof sort.desc === "boolean"
        ? [{ id: sort.id, desc: sort.desc }]
        : fallback.sorting,
    filters: normalizeDatasetFilters({
      companyIds: strings(filters.companyIds),
      dateFrom: text(filters.dateFrom),
      dateTo: text(filters.dateTo),
      skus: strings(filters.skus),
      marketplaces: strings(filters.marketplaces),
      sources: strings(filters.sources),
      types: strings(filters.types),
      feeApplicability: strings(filters.feeApplicability),
    }),
    selectedRowId: nullableText(value.selectedRowId),
  };
}

export function decodeDatasetViews(
  value: unknown,
): Partial<Record<TableDatasetKey, DatasetViewState>> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    (Object.keys(DATASET_CONFIG) as TableDatasetKey[])
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, decodeDatasetView(value[key], key)]),
  );
}

export function decodeInventoryView(value: unknown): InventoryViewState {
  if (!isJsonObject(value)) return createInventoryViewState();
  return {
    search: text(value.search),
    skus: strings(value.skus),
    healthStatuses: optionalStrings(value.healthStatuses).filter((entry) =>
      INVENTORY_HEALTH_VALUES.includes(entry),
    ),
    recommendations: optionalStrings(value.recommendations).filter((entry) =>
      INVENTORY_RECOMMENDATION_VALUES.includes(entry),
    ),
    marketplaces: strings(value.marketplaces),
    companyIds: optionalStrings(value.companyIds).filter((id) => id === null || isUuid(id)),
    sortColumn: INVENTORY_SORT_COLUMNS.find((column) => column === value.sortColumn) ?? "sku",
    sortDirection: value.sortDirection === "desc" ? "desc" : "asc",
    pageIndex: pageIndex(value.pageIndex),
    pageSize: pageSize(value.pageSize),
    selectedRowId: nullableText(value.selectedRowId),
  };
}

function decodeDraft(value: unknown): SkuConfigurationChange | null {
  if (
    !isJsonObject(value) ||
    !isText(value.sku) ||
    !(value.company_id === null || isText(value.company_id)) ||
    !(value.expected_current_version_id === null || isText(value.expected_current_version_id)) ||
    !Array.isArray(value.periods) ||
    value.periods.length > 10000
  )
    return null;
  const periods: SkuConfigurationPeriod[] = [];
  const savedPeriods: unknown[] = value.periods;
  for (const period of savedPeriods) {
    if (
      !isJsonObject(period) ||
      !isText(period.marketplace_name) ||
      !isText(period.valid_from) ||
      !(period.valid_to === null || isText(period.valid_to)) ||
      !isText(period.fee_rate_percent)
    )
      return null;
    periods.push({
      marketplace_name: period.marketplace_name,
      valid_from: period.valid_from,
      valid_to: period.valid_to,
      fee_rate_percent: period.fee_rate_percent,
    });
  }
  return {
    sku: value.sku,
    company_id: value.company_id,
    expected_current_version_id: value.expected_current_version_id,
    periods,
  };
}

function decodeFeeEditor(value: unknown): FeeViewState["editing"] {
  if (!isJsonObject(value) || !isText(value.sku) || typeof value.isNew !== "boolean") return null;
  const form = decodeDraft(value.form);
  if (!form || (!value.isNew && form.sku !== value.sku)) return null;
  const rateChange = value.rateChange;
  return {
    sku: value.sku,
    isNew: value.isNew,
    form,
    submitError: nullableText(value.submitError),
    rateChange:
      isJsonObject(rateChange) &&
      typeof rateChange.periodIndex === "number" &&
      Number.isSafeInteger(rateChange.periodIndex) &&
      rateChange.periodIndex >= 0 &&
      rateChange.periodIndex < form.periods.length
        ? {
            periodIndex: rateChange.periodIndex,
            effectiveDate: text(rateChange.effectiveDate),
            feeRatePercent: text(rateChange.feeRatePercent),
            previewRequested: rateChange.previewRequested === true,
          }
        : null,
  };
}

export function decodeFeeView(value: unknown): FeeViewState {
  if (!isJsonObject(value)) return createFeeViewState();
  const interrupted = value.savePending === true;
  return {
    search: text(value.search),
    pageIndex: pageIndex(value.pageIndex),
    pageSize: pageSize(value.pageSize),
    expanded: strings(value.expanded),
    drafts: Array.isArray(value.drafts)
      ? value.drafts
          .slice(0, 10000)
          .map(decodeDraft)
          .filter((draft) => draft !== null)
      : [],
    changeReason: text(value.changeReason),
    onlyIncomplete: value.onlyIncomplete === true,
    saveProblem: interrupted
      ? "The page reloaded before the save was confirmed. Refresh saved settings and review your drafts before saving again."
      : nullableText(value.saveProblem),
    requiresReload: interrupted || value.requiresReload === true,
    savedNotice: nullableText(value.savedNotice),
    refreshFailed: value.refreshFailed === true,
    editing: decodeFeeEditor(value.editing),
    editorDrafts: Array.isArray(value.editorDrafts)
      ? value.editorDrafts
          .slice(0, 10000)
          .map(decodeFeeEditor)
          .filter((editor) => editor !== null)
      : [],
    reviewing: value.reviewing === true,
    savePending: false,
  };
}
