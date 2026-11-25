import type { RefObject } from "react";
import { DATASET_CONFIG, type DatasetFilters, type TableDatasetKey } from "./api";
import type { DatasetConfig } from "./api/config";
import { humanizeCode, sourceCodeLabel } from "./categories";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";
import { formatRecordMonth } from "./date-display";
import { companyLabel } from "./view-model";
import { AppliedFilterChips } from "./AppliedFilterChips";

interface AppliedFilter {
  label: string;
  values: string[];
  summary?: string;
  clear: Partial<DatasetFilters>;
}

export function AppliedTableFilters({
  dataset,
  filters,
  companies,
  typeLabels,
  onChange,
  focusTarget,
}: {
  dataset: TableDatasetKey;
  filters: DatasetFilters;
  companies: Map<string, string>;
  typeLabels?: string[];
  onChange: (filters: Partial<DatasetFilters>) => void;
  focusTarget?: RefObject<HTMLElement | null>;
}) {
  if (activeFilterCount(filters) === 0) return null;
  const { dateFilter }: DatasetConfig = DATASET_CONFIG[dataset];
  const dateLabel =
    dateFilter?.kind === "month"
      ? formatRecordMonth(filters.dateFrom)
      : filters.dateFrom
        ? filters.dateTo
          ? `${filters.dateFrom} – ${filters.dateTo}`
          : `From ${filters.dateFrom}`
        : `Through ${filters.dateTo}`;
  const applied: AppliedFilter[] = [
    {
      label: "Company",
      values: filters.companyIds.map((id) => companyLabel(id, companies)),
      clear: { companyIds: [] },
    },
    {
      label: dateFilter?.label ?? "Date",
      values: filters.dateFrom || filters.dateTo ? [dateLabel] : [],
      clear: { dateFrom: "", dateTo: "" },
    },
    { label: "SKU", values: filters.skus, clear: { skus: [] } },
    { label: "Marketplace", values: filters.marketplaces, clear: { marketplaces: [] } },
    { label: "Source", values: filters.sources.map(humanizeCode), clear: { sources: [] } },
    {
      label: "Type",
      values: typeLabels ?? filters.types.map(sourceCodeLabel),
      summary: typeLabels?.length
        ? `${typeLabels[0]}${typeLabels.length > 1 ? ` +${String(typeLabels.length - 1)}` : ""}`
        : undefined,
      clear: { types: [] },
    },
    {
      label: "Fee rate",
      values:
        filters.feeApplicability.length === 1
          ? [filters.feeApplicability[0] === "applicable" ? "Applicable" : "Not applicable"]
          : [],
      clear: { feeApplicability: [] },
    },
  ];

  const chips = applied
    .filter(({ values }) => values.length > 0)
    .map(({ label, values, summary, clear }) => {
      const visibleLabel = `${label}: ${summary ?? (values.length === 1 ? values[0] : `${String(values.length)} selected`)}`;
      return {
        key: label,
        label: visibleLabel,
        ariaLabel: `${visibleLabel}. Clear filter.`,
        description: `${label}: ${values.join(", ")}`,
        clear,
      };
    });
  return (
    <AppliedFilterChips
      label="Applied table filters"
      chips={chips}
      onChange={onChange}
      focusTarget={focusTarget}
      onClearAll={() => {
        onChange(normalizeDatasetFilters());
      }}
    />
  );
}
