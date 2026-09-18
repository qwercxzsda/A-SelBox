import { DATASET_CONFIG, type DatasetConfig } from "./config.ts";
import type { DatasetFilterField, DatasetFilters, DatasetKey } from "./types.ts";

export function requireFilterField(dataset: DatasetKey, field: DatasetFilterField): void {
  if (!Object.hasOwn(DATASET_CONFIG, dataset)) throw new Error("Dataset is invalid");
  const config: DatasetConfig = DATASET_CONFIG[dataset];
  if (!config.filterColumns.includes(field)) {
    throw new Error(`This column cannot be filtered in ${config.label}`);
  }
}

function requireCalendarDate(value: string): void {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Choose a valid date in YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid calendar date");
  }
}

function quoteListValue(value: string): string {
  if (value.includes("\0")) throw new Error("Filter values cannot contain a null character");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function applyDatasetVisibility(dataset: DatasetKey, params: URLSearchParams): void {
  if (dataset === "data_kiosk") params.set("amount", "neq.0");
  if (dataset === "live") {
    params.set("and", "(or(source.neq.DATA_KIOSK,source_amount.neq.0))");
  }
}

export function applyDatasetFilters(
  dataset: DatasetKey,
  params: URLSearchParams,
  filters?: DatasetFilters,
): void {
  if (!filters) return;
  const { dateFrom, dateTo } = filters;
  if (dateFrom) requireCalendarDate(dateFrom);
  if (dateTo) requireCalendarDate(dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("The start date must be on or before the end date");
  }
  const { dateColumn } = DATASET_CONFIG[dataset];
  if ((dateFrom || dateTo) && dateColumn === null) {
    throw new Error("Date filtering is unavailable for this view");
  }
  if (dateColumn !== null) {
    if (dateFrom) params.append(dateColumn, `gte.${dateFrom}`);
    if (dateTo) params.append(dateColumn, `lte.${dateTo}`);
  }
  for (const [field, values] of [
    ["sku", filters.skus],
    ["marketplace_name", filters.marketplaces],
    ["source", filters.sources],
    ["component_type", filters.types],
  ] as const) {
    if (values.length === 0) continue;
    requireFilterField(dataset, field);
    params.set(field, `in.(${[...new Set(values)].map(quoteListValue).join(",")})`);
  }
}
