import { Button, Group, Text, Tooltip } from "@mantine/core";
import type { DatasetFilters, TableDatasetKey } from "./api";
import { humanizeCode, transactionTypeLabel } from "./categories";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";
import { companyLabel } from "./view-model";

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
}: {
  dataset: TableDatasetKey;
  filters: DatasetFilters;
  companies: Map<string, string>;
  typeLabels?: string[];
  onChange: (filters: Partial<DatasetFilters>) => void;
}) {
  const count = activeFilterCount(filters);
  if (count === 0) return null;
  const dateLabel = filters.dateFrom
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
      label: dataset === "payouts" ? "Report month" : "Date",
      values:
        filters.dateFrom || filters.dateTo
          ? [dataset === "payouts" ? filters.dateFrom.slice(0, 7) : dateLabel]
          : [],
      clear: { dateFrom: "", dateTo: "" },
    },
    { label: "SKU", values: filters.skus, clear: { skus: [] } },
    { label: "Marketplace", values: filters.marketplaces, clear: { marketplaces: [] } },
    { label: "Source", values: filters.sources.map(humanizeCode), clear: { sources: [] } },
    {
      label: "Type",
      values: typeLabels ?? filters.types.map(transactionTypeLabel),
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

  return (
    <Group
      className="applied-table-filters"
      gap="xs"
      mb="xs"
      role="group"
      aria-label="Applied table filters"
    >
      <Text size="xs" c="dimmed">
        {count} {count === 1 ? "filter" : "filters"} applied
      </Text>
      {applied
        .filter(({ values }) => values.length > 0)
        .map(({ label, values, summary, clear }) => {
          const description = `${label}: ${values.join(", ")}`;
          return (
            <Tooltip
              key={label}
              label={description}
              multiline
              maw="min(420px, calc(100vw - 24px))"
              withArrow
              events={{ hover: true, focus: true, touch: false }}
            >
              <Button
                className="applied-table-filter"
                size="compact-xs"
                variant="light"
                aria-label={`Clear ${label.toLowerCase()} filter: ${values.join(", ")}`}
                onClick={() => {
                  onChange(clear);
                }}
                rightSection={<span aria-hidden="true">×</span>}
              >
                <span className="applied-table-filter-text">
                  {label}:{" "}
                  {summary ??
                    (values.length === 1 ? values[0] : `${String(values.length)} selected`)}
                </span>
              </Button>
            </Tooltip>
          );
        })}
      <Button
        size="compact-xs"
        variant="subtle"
        onClick={() => {
          onChange(normalizeDatasetFilters());
        }}
      >
        Clear filters
      </Button>
    </Group>
  );
}
