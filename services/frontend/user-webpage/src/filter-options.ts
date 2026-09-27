import marketplaces from "./generated/marketplaces.json" with { type: "json" };
import transactionTypes from "./generated/transaction-types.json" with { type: "json" };
import type { AppAccount, DatasetFilterField, TableDatasetKey } from "./api/types.ts";
import { humanizeCode, transactionTypeLabel } from "./categories.ts";

type AccessRole = AppAccount["access_role"];

export interface FilterOption {
  value: string;
  label: string;
  title?: string;
}

/** Source names identify the imported dataset, independently of allocation category. */
export const TRANSACTION_SOURCES = ["SETTLEMENT", "DATA_KIOSK"] as const;

export function transactionTypeValues(dataset: TableDatasetKey, role: AccessRole): string[] {
  return transactionTypes
    .filter(({ source, category }) => {
      if (role !== "operator" && category === "SELBOX") return false;
      if (dataset === "settlement") return source === "SETTLEMENT";
      if (dataset === "data_kiosk") return source === "DATA_KIOSK";
      return dataset === "live";
    })
    .map(({ type }) => type);
}

/** Local options do not depend on matching facts, search, dates, or other selections. */
export function localFilterValues(
  field: DatasetFilterField,
  dataset: TableDatasetKey,
  role: AccessRole,
  skuOptions: readonly string[],
): readonly string[] {
  switch (field) {
    case "source":
      return TRANSACTION_SOURCES;
    case "marketplace_name":
      return marketplaces;
    case "component_type":
      return transactionTypeValues(dataset, role);
    case "sku":
      return skuOptions;
  }
}

/** Preserve exact keys and selected values even after assignments or registry entries change. */
export function filterOptions(
  field: DatasetFilterField,
  values: readonly string[],
  selected: readonly string[] = [],
): FilterOption[] {
  return [...new Set([...values, ...selected])]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      value,
      title: field === "component_type" ? value : undefined,
      label:
        field === "component_type"
          ? transactionTypeLabel(value)
          : field === "source"
            ? humanizeCode(value)
            : value,
    }));
}
