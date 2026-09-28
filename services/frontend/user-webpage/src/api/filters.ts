import { DATASET_CONFIG, isTableDataset, type DatasetConfig } from "./config.ts";
import type { DatasetFilterField, DatasetFilters, TableDatasetKey } from "./types.ts";
import { isUuid } from "./validation.ts";

export function requireFilterField(dataset: TableDatasetKey, field: DatasetFilterField): void {
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  const config: DatasetConfig = DATASET_CONFIG[dataset];
  if (!config.filterColumns.includes(field)) {
    throw new Error(`This column cannot be filtered in ${config.label}`);
  }
}

export function requireCalendarDate(value: string): void {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Choose a valid date in YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid calendar date");
  }
}

export function textSelectionValues(field: DatasetFilterField, selection?: string[]): string[] {
  if (selection === undefined) return [];
  const label = field === "sku" ? "SKU" : field === "marketplace_name" ? "marketplace" : "filter";
  if (!Array.isArray(selection)) throw new Error(`Choose valid ${label} values`);
  const values = [...new Set(selection)];
  if (
    values.some((value) => typeof value !== "string" || value.length === 0 || value.includes("\0"))
  ) {
    throw new Error(`Choose valid ${label} values`);
  }
  return values;
}

export function companySelectionValues(companyIds?: string[]): string[] {
  if (companyIds === undefined) return [];
  if (!Array.isArray(companyIds) || [...companyIds].some((id) => !isUuid(id))) {
    throw new Error("Choose valid company IDs");
  }
  return [...new Set(companyIds)].sort();
}

export function requireDateRange(dateFrom: string, dateTo: string): void {
  if (dateFrom) requireCalendarDate(dateFrom);
  if (dateTo) requireCalendarDate(dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("The start date must be on or before the end date");
  }
}

/** Validate once for both RPC arguments and direct non-transaction REST requests. */
export function datasetFilterValues(dataset: TableDatasetKey, filters?: DatasetFilters) {
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  const companyIds = companySelectionValues(filters?.companyIds);
  const feeApplicable = feeApplicabilityValue(filters?.feeApplicability);
  const dateFrom = filters?.dateFrom ?? "";
  const dateTo = filters?.dateTo ?? "";
  const selections = {
    sku: textSelectionValues("sku", filters?.skus),
    marketplace_name: textSelectionValues("marketplace_name", filters?.marketplaces),
    source: textSelectionValues("source", filters?.sources),
    component_type: textSelectionValues("component_type", filters?.types),
  };
  if (feeApplicable !== null && dataset !== "live")
    throw new Error("Fee applicability filtering is unavailable for this view");
  if (companyIds.length > 0 && dataset !== "live" && dataset !== "payouts")
    throw new Error("Company filtering is unavailable for this view");
  requireDateRange(dateFrom, dateTo);
  if ((dateFrom || dateTo) && DATASET_CONFIG[dataset].dateColumn === null)
    throw new Error("Date filtering is unavailable for this view");
  for (const field of Object.keys(selections) as DatasetFilterField[]) {
    if (selections[field].length > 0) requireFilterField(dataset, field);
  }
  return { companyIds, dateFrom, dateTo, feeApplicable, selections };
}

/** Type applicability is independent of whether a fee rate is zero, missing, or configured. */
function feeApplicabilityValue(selection: string[] = []): boolean | null {
  if (!Array.isArray(selection)) throw new Error("Choose valid fee applicability values");
  const values = [...new Set(selection)];
  if (values.some((value) => value !== "applicable" && value !== "not_applicable")) {
    throw new Error("Choose valid fee applicability values");
  }
  return values.length === 1 ? values[0] === "applicable" : null;
}
