import { DATASET_CONFIG, type DatasetConfig } from "./config.ts";
import type { DatasetFilterField, DatasetFilters, DatasetKey } from "./types.ts";

export function requireFilterField(dataset: DatasetKey, field: DatasetFilterField): void {
  if (!Object.hasOwn(DATASET_CONFIG, dataset)) throw new Error("Dataset is invalid");
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

function quoteListValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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
  if (
    !Array.isArray(companyIds) ||
    [...companyIds].some(
      (id) => typeof id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id),
    )
  ) {
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
export function datasetFilterValues(dataset: DatasetKey, filters?: DatasetFilters) {
  if (!Object.hasOwn(DATASET_CONFIG, dataset)) throw new Error("Dataset is invalid");
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
  if (companyIds.length > 0 && dataset !== "live")
    throw new Error("Company filtering is unavailable for this view");
  requireDateRange(dateFrom, dateTo);
  if ((dateFrom || dateTo) && DATASET_CONFIG[dataset].dateColumn === null)
    throw new Error("Date filtering is unavailable for this view");
  for (const field of Object.keys(selections) as DatasetFilterField[]) {
    if (selections[field].length > 0) requireFilterField(dataset, field);
  }
  return { companyIds, dateFrom, dateTo, feeApplicable, selections };
}

/** Direct view reads currently support only the Current fees marketplace selection. */
export function applyDatasetFilters(
  dataset: DatasetKey,
  params: URLSearchParams,
  filters?: DatasetFilters,
): void {
  const { selections } = datasetFilterValues(dataset, filters);
  for (const [field, values] of Object.entries(selections)) {
    if (values.length > 0) params.set(field, `in.(${values.map(quoteListValue).join(",")})`);
  }
}

/** Applicability depends on the source fee base, including zero and missing configured rates. */
export function feeApplicabilityValue(selection: string[] = []): boolean | null {
  if (!Array.isArray(selection)) throw new Error("Choose valid fee applicability values");
  const values = [...new Set(selection)];
  if (values.some((value) => value !== "applicable" && value !== "not_applicable")) {
    throw new Error("Choose valid fee applicability values");
  }
  return values.length === 1 ? values[0] === "applicable" : null;
}
