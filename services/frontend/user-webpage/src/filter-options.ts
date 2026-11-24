import marketplaces from "./generated/marketplaces.json" with { type: "json" };
import transactionTypes from "./generated/transaction-types.json" with { type: "json" };
import type { AppAccount, DatasetFilterField, TableDatasetKey } from "./api/types.ts";
import { humanizeCode, sourceCodeLabel } from "./categories.ts";

type AccessRole = AppAccount["access_role"];

export interface FilterOption {
  value: string;
  label: string;
  title?: string;
  description?: string;
}

/** Sources that can contribute company or SelBox amounts. */
export const TRANSACTION_SOURCES = [
  "FINANCES",
  "AD_INVOICE",
  "STORAGE",
  "AGED_STORAGE",
  "REMOVAL_ORDER",
] as const;

export function transactionTypeValues(dataset: TableDatasetKey, role: AccessRole): string[] {
  if (dataset === "finances" && role === "administrator")
    return transactionTypes.map(({ type }) => type);
  if (dataset !== "live" || role === "unassigned") return [];
  return transactionTypes
    .filter(
      ({ type, selbox_group }) =>
        type !== "BANK_TRANSFERS" && (!selbox_group || role === "administrator"),
    )
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

/** Menus and literal search use the same displayed labels for source and type keys. */
export function filterOptionLabel(field: DatasetFilterField, value: string): string {
  return field === "component_type"
    ? sourceCodeLabel(value)
    : field === "source"
      ? humanizeCode(value)
      : value;
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
      label: filterOptionLabel(field, value),
    }));
}
