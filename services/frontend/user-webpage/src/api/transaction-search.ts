import { textSelectionValues } from "./filters.ts";
import type { TransactionSearchValues } from "./types.ts";
import { isJsonObject } from "./validation.ts";

/** Never turn an unresolved or empty active search into an unrestricted transaction read. */
export function validateTransactionSearch(
  search: string,
  values?: TransactionSearchValues | null,
): TransactionSearchValues | null {
  if (typeof search !== "string") throw new Error("Choose valid search text");
  if (!search.trim()) {
    if (values !== null && values !== undefined)
      throw new Error("Empty search text cannot include search values");
    return null;
  }
  if (!isJsonObject(values))
    throw new Error("Resolve transaction search values before loading rows");
  for (const key of ["skus", "marketplaces", "types", "sources"] as const) {
    if (!Array.isArray(values[key])) throw new Error("Choose valid transaction search values");
  }
  return {
    skus: textSelectionValues("sku", values.skus).sort(),
    marketplaces: textSelectionValues("marketplace_name", values.marketplaces).sort(),
    types: textSelectionValues("component_type", values.types).sort(),
    sources: textSelectionValues("source", values.sources).sort(),
  };
}
