import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDatasetFilterOptions } from "./api";
import { DATASET_CONFIG } from "./api/config";
import type { DatasetFilterField, DatasetFilters, TableDatasetKey, DatasetSort } from "./api/types";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import { humanizeCode, transactionTypeLabel } from "./categories";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage, type ColumnDefinition } from "./view-model";
import { MAX_AMOUNT_ORDER_ROWS } from "./api/amount-ordering";
import { isTransactionDataset } from "./api/transaction-page";

const SELECTION_KEYS = {
  sku: "skus",
  marketplace_name: "marketplaces",
  source: "sources",
  component_type: "types",
} as const;

interface FinanceColumnHeaderProps {
  column: ColumnDefinition;
  dataset: TableDatasetKey;
  identity: Identity;
  filters: DatasetFilters;
  onFiltersChange: (patch: Partial<DatasetFilters>) => void;
  sort: DatasetSort;
  onSortChange: (sort: DatasetSort) => void;
  totalCount: number | null;
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
          title: field === "component_type" ? value : undefined,
          label:
            field === "component_type"
              ? transactionTypeLabel(value)
              : field === "source"
                ? humanizeCode(value)
                : value,
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
  const { column, dataset, identity, filters, onFiltersChange, sort, onSortChange, totalCount } =
    props;
  if (dataset === "live" && column.key === "fee_rate_percent") {
    return (
      <ColumnMenu
        label={column.label}
        filter={{
          kind: "selection",
          value: filters.feeApplicability,
          options: [
            { value: "applicable", label: "Applicable" },
            { value: "not_applicable", label: "Not applicable" },
          ],
          onChange: (feeApplicability) => {
            onFiltersChange({ feeApplicability });
          },
        }}
      />
    );
  }
  if (
    dataset === "live" &&
    column.key === "company_id" &&
    identity.account.access_role === "operator"
  ) {
    const companies = new Map(identity.companies.map(({ id, name }) => [id, name]));
    return (
      <ColumnMenu
        label={column.label}
        filter={{
          kind: "selection",
          value: filters.companyIds,
          options: [...companies.keys()]
            .map((value) => ({ value, label: companyLabel(value, companies) }))
            .sort((left, right) => left.label.localeCompare(right.label)),
          onChange: (companyIds) => {
            onFiltersChange({ companyIds });
          },
        }}
      />
    );
  }
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
        disabledReason:
          isTransactionDataset(dataset) &&
          column.kind === "money" &&
          totalCount !== null &&
          totalCount > MAX_AMOUNT_ORDER_ROWS
            ? `${totalCount.toLocaleString("en-US")} matching rows. Narrow your filters to ${MAX_AMOUNT_ORDER_ROWS.toLocaleString("en-US")} or fewer to order by amount, or order by Date.`
            : undefined,
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
