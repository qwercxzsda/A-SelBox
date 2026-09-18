import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDatasetFilterOptions } from "./api/client";
import { DATASET_CONFIG } from "./api/config";
import type { DatasetFilterField, DatasetFilters, DatasetKey, DatasetSort } from "./api/types";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import { humanizeCode } from "./categories";
import type { Identity } from "./use-auth";
import { getErrorMessage, type ColumnDefinition } from "./view-model";

const SELECTION_KEYS = {
  sku: "skus",
  marketplace_name: "marketplaces",
  source: "sources",
  component_type: "types",
} as const;

interface FinanceColumnHeaderProps {
  column: ColumnDefinition;
  dataset: DatasetKey;
  identity: Identity;
  filters: DatasetFilters;
  onFiltersChange: (patch: Partial<DatasetFilters>) => void;
  sort: DatasetSort;
  onSortChange: (sort: DatasetSort) => void;
}

function SelectionColumnHeader({
  column,
  dataset,
  identity,
  filters,
  onFiltersChange,
  field,
}: FinanceColumnHeaderProps & { field: DatasetFilterField }) {
  const [opened, setOpened] = useState(false);
  const { session, account } = identity;
  const query = useQuery({
    queryKey: [
      "dataset-options",
      session.user.id,
      account.access_role,
      account.company_id,
      dataset,
      field,
    ],
    queryFn: ({ signal }) =>
      fetchDatasetFilterOptions(session.access_token, dataset, field, signal),
    enabled: opened,
  });
  const key = SELECTION_KEYS[field];
  const selected = filters[key];
  const choices = [...new Set([...(query.data ?? []), ...selected])].sort((a, b) =>
    a.localeCompare(b),
  );
  return (
    <ColumnMenu
      label={column.label}
      onOpen={() => {
        setOpened(true);
      }}
      onClose={() => {
        setOpened(false);
      }}
      filter={{
        kind: "selection",
        value: selected,
        options: choices.map((value) => ({
          value,
          label: field === "source" || field === "component_type" ? humanizeCode(value) : value,
        })),
        onChange: (value) => {
          onFiltersChange({ [key]: value });
        },
        isLoading: query.isPending,
        error: query.error ? getErrorMessage(query.error) : undefined,
        onRetry: () => {
          void query.refetch();
        },
      }}
    />
  );
}

export function FinanceColumnHeader(props: FinanceColumnHeaderProps) {
  const { column, dataset, filters, onFiltersChange, sort, onSortChange } = props;
  const config = DATASET_CONFIG[dataset];
  const fields: readonly DatasetFilterField[] = config.filterColumns;
  const field = fields.find((value) => value === column.key);
  if (field) return <SelectionColumnHeader {...props} field={field} />;

  const dateFilter = config.dateColumn === column.key;
  if (!dateFilter && !column.sortable) return column.label;
  const date = column.kind === "date";
  const numeric = column.kind === "money" || column.kind === "percent" || column.kind === "number";
  const ordering: ColumnMenuSort | undefined = column.sortable
    ? {
        direction: sort.column === column.key ? sort.direction : false,
        onChange: (direction) => {
          onSortChange({ column: column.key, direction });
        },
        ascendingLabel: date ? "Oldest first" : numeric ? "Lowest first" : "Ascending",
        descendingLabel: date ? "Newest first" : numeric ? "Highest first" : "Descending",
      }
    : undefined;
  return (
    <ColumnMenu
      label={column.label}
      filter={
        dateFilter
          ? {
              kind: "date",
              from: filters.dateFrom,
              to: filters.dateTo,
              onChange: (dateFrom, dateTo) => {
                onFiltersChange({ dateFrom, dateTo });
              },
            }
          : undefined
      }
      sort={ordering}
    />
  );
}
