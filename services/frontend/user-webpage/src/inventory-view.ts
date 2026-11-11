import type { InventoryRow } from "./api/inventory.ts";
import { compareDecimals } from "./decimal.ts";
import { inventoryUrgency, recommendationLabel } from "./inventory-options.ts";

export const INVENTORY_SORT_COLUMNS = [
  "sku",
  "sales_amount_90d",
  "health_status",
  "recommended_action",
] as const;
export type InventorySortColumn = (typeof INVENTORY_SORT_COLUMNS)[number];
export interface InventoryPageOptions {
  search: string;
  skus: string[];
  healthStatuses: (string | null)[];
  recommendations: (string | null)[];
  marketplaces: string[];
  companyIds: (string | null)[];
  sortColumn: InventorySortColumn;
  sortDirection: "asc" | "desc";
  pageIndex: number;
  pageSize: number;
}
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Filter and order the complete authorized snapshot before taking a display page. */
export function inventoryPage(allRows: readonly InventoryRow[], options: InventoryPageOptions) {
  const term = options.search.trim().toLocaleLowerCase();
  const { sortColumn, sortDirection } = options;
  const rows = allRows.filter(
    (row) =>
      (!options.marketplaces.length || options.marketplaces.includes(row.marketplace_name)) &&
      (!options.companyIds.length || options.companyIds.includes(row.company_id)) &&
      (!options.skus.length || options.skus.includes(row.sku)) &&
      (!options.healthStatuses.length || options.healthStatuses.includes(row.health_status)) &&
      (!options.recommendations.length ||
        options.recommendations.includes(row.recommended_action)) &&
      (!term ||
        [
          row.sku,
          row.marketplace_name,
          row.health_status ?? "Unavailable",
          row.recommended_action,
          recommendationLabel(row.recommended_action),
        ].some((value) => value?.toLocaleLowerCase().includes(term))),
  );
  rows.sort((left, right) => {
    const a = left[sortColumn],
      b = right[sortColumn];
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    let comparison = 0;
    if (a !== null && b !== null) {
      comparison =
        sortColumn === "sales_amount_90d"
          ? compareDecimals(a, b)
          : sortColumn === "sku"
            ? compareText(a, b)
            : (inventoryUrgency(sortColumn, a) ?? 0) - (inventoryUrgency(sortColumn, b) ?? 0);
    }
    if (comparison) return sortDirection === "desc" ? -comparison : comparison;
    return (
      compareText(left.sku, right.sku) ||
      compareText(left.marketplace_name, right.marketplace_name) ||
      compareText(left.capture_id, right.capture_id)
    );
  });
  const offset = options.pageIndex * options.pageSize;
  return { rows: rows.slice(offset, offset + options.pageSize), totalCount: rows.length };
}
