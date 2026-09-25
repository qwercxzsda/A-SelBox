import type { DatasetFilters } from "./api/types.ts";

export function normalizeSelections(values: readonly string[] = []): string[] {
  return [...new Set(values)].sort();
}

export function normalizeDatasetFilters(filters?: DatasetFilters): DatasetFilters {
  return {
    companyIds: normalizeSelections(filters?.companyIds),
    dateFrom: filters?.dateFrom ?? "",
    dateTo: filters?.dateTo ?? "",
    skus: normalizeSelections(filters?.skus),
    marketplaces: normalizeSelections(filters?.marketplaces),
    sources: normalizeSelections(filters?.sources),
    types: normalizeSelections(filters?.types),
    feeApplicability: normalizeSelections(filters?.feeApplicability),
  };
}

export function activeFilterCount(filters: DatasetFilters): number {
  return [
    filters.companyIds.length > 0,
    Boolean(filters.dateFrom || filters.dateTo),
    filters.skus.length > 0,
    filters.marketplaces.length > 0,
    filters.sources.length > 0,
    filters.types.length > 0,
    filters.feeApplicability.length === 1,
  ].filter(Boolean).length;
}
