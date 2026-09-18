import type { DatasetFilters } from "./api/types.ts";

export function normalizeDatasetFilters(filters?: DatasetFilters): DatasetFilters {
  const selections = (values: string[] | undefined) => [...new Set(values ?? [])].sort();
  return {
    dateFrom: filters?.dateFrom ?? "",
    dateTo: filters?.dateTo ?? "",
    skus: selections(filters?.skus),
    marketplaces: selections(filters?.marketplaces),
    sources: selections(filters?.sources),
    types: selections(filters?.types),
  };
}

export function activeFilterCount(filters: DatasetFilters): number {
  return [
    Boolean(filters.dateFrom || filters.dateTo),
    filters.skus.length > 0,
    filters.marketplaces.length > 0,
    filters.sources.length > 0,
    filters.types.length > 0,
  ].filter(Boolean).length;
}
