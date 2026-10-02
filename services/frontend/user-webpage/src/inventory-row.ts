import type { InventoryRow } from "./api/inventory.ts";

/** A capture distinguishes identical SKU names across seller/marketplace scopes. */
export function inventoryRowId(row: Pick<InventoryRow, "capture_id" | "sku">): string {
  return JSON.stringify([row.capture_id, row.sku]);
}
