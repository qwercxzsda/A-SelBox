import type { AppAccount, TableDatasetKey, TransactionSearchValues } from "./api/types.ts";
import { localFilterValues } from "./filter-options.ts";
import { humanizeCode, transactionTypeLabel } from "./categories.ts";

/** Resolve literal, case-insensitive text locally; the database receives exact OR sets. */
export function resolveTransactionSearch(
  dataset: TableDatasetKey,
  role: AppAccount["access_role"],
  skuOptions: readonly string[],
  search: string,
): TransactionSearchValues | null {
  const term = search.trim().toLowerCase();
  if (!term) return null;
  const matches = (field: "sku" | "component_type" | "marketplace_name" | "source") => {
    const values = new Set<string>();
    for (const value of localFilterValues(field, dataset, role, skuOptions)) {
      const label =
        field === "component_type"
          ? transactionTypeLabel(value)
          : field === "source"
            ? humanizeCode(value)
            : value;
      if (value.toLowerCase().includes(term) || label.toLowerCase().includes(term))
        values.add(value);
    }
    return [...values].sort();
  };
  return {
    skus: matches("sku"),
    types: matches("component_type"),
    marketplaces: matches("marketplace_name"),
    sources: dataset === "live" ? matches("source") : [],
  };
}
