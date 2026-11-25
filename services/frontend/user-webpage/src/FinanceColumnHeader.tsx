import { DATASET_CONFIG, type DateFilterConfig } from "./api/config";
import type { DatasetFilterField, DatasetFilters, TableDatasetKey, DatasetSort } from "./api/types";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import type { ColumnMenuFilter } from "./ColumnFilters";
import { filterOptions, localFilterValues } from "./filter-options";
import type { Identity } from "./auth-session";
import { isAmountKind, type ColumnDefinition } from "./table-columns";
import { companyLabel, DATASET_PRESENTATION } from "./view-model";
import { countLabel } from "./pagination";
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

/** A month filter selects one month start; a range filter selects days. */
function dateColumnFilter(
  dateFilter: DateFilterConfig,
  filters: DatasetFilters,
  onFiltersChange: (patch: Partial<DatasetFilters>) => void,
): ColumnMenuFilter {
  return dateFilter.kind === "month"
    ? {
        kind: "month",
        label: dateFilter.label,
        value: filters.dateFrom.slice(0, 7),
        onChange: (month) => {
          const date = month ? `${month}-01` : "";
          onFiltersChange({ dateFrom: date, dateTo: date });
        },
      }
    : {
        kind: "date",
        from: filters.dateFrom,
        to: filters.dateTo,
        onChange: (dateFrom, dateTo) => {
          onFiltersChange({ dateFrom, dateTo });
        },
      };
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
        groupBy: field === "component_type" ? "transaction-type" : undefined,
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
  if (dataset === "live" && column.key === "fee_amount") {
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
    (dataset === "live" || dataset === "payouts" || dataset === "accounts") &&
    column.key === "company_id" &&
    identity.account.access_role === "administrator"
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

  const dateFilter: DateFilterConfig | null =
    config.dateFilter?.column === column.key ? config.dateFilter : null;
  if (!dateFilter && !column.sortable) return column.label;
  const date = column.kind === "date" || column.kind === "month";
  const numeric =
    isAmountKind(column.kind) || column.kind === "percent" || column.kind === "number";
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
          isAmountKind(column.kind) &&
          totalCount !== null &&
          totalCount > MAX_AMOUNT_ORDER_ROWS
            ? `${countLabel(totalCount, DATASET_PRESENTATION[dataset].items)} match. Amount order needs ${MAX_AMOUNT_ORDER_ROWS.toLocaleString("en-US")} or fewer.`
            : undefined,
      }
    : undefined;
  return (
    <ColumnMenu
      label={column.label}
      filter={dateFilter ? dateColumnFilter(dateFilter, filters, onFiltersChange) : undefined}
      sort={ordering}
    />
  );
}
