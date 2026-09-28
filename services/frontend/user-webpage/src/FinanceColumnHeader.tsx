import { DATASET_CONFIG } from "./api/config";
import type { DatasetFilterField, DatasetFilters, TableDatasetKey, DatasetSort } from "./api/types";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import { filterOptions, localFilterValues } from "./filter-options";
import type { Identity } from "./auth-session";
import { companyLabel, type ColumnDefinition } from "./view-model";
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
  const key = SELECTION_KEYS[field];
  const selected = filters[key];
  const choices = localFilterValues(
    field,
    dataset,
    identity.account.access_role,
    identity.skuOptions,
  );
  return (
    <ColumnMenu
      label={column.label}
      filter={{
        kind: "selection",
        value: selected,
        options: filterOptions(field, choices, selected),
        onChange: (value) => {
          onFiltersChange({ [key]: value });
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

  // Payouts use the month control so browsing and generation share one period.
  const dateFilter = dataset !== "payouts" && config.dateColumn === column.key;
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
