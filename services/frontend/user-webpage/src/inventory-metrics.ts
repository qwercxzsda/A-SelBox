import type { InventoryRow } from "./api/inventory";

export type InventoryMetricDefinition = readonly [keyof InventoryRow, string];

export const INVENTORY_METRICS = {
  sales: [
    ["sales_amount_90d", "Sales"],
    ["units_shipped_90d", "Units shipped"],
  ],
  overview: [
    ["available_quantity", "Available"],
    ["fba_supply_quantity", "Supply at FBA"],
    ["inbound_quantity", "Inbound"],
    ["reserved_quantity", "Reserved"],
    ["unfulfillable_quantity", "Unfulfillable"],
  ],
  breakdown: [
    ["inbound_working_quantity", "Inbound working"],
    ["inbound_shipped_quantity", "Inbound shipped"],
    ["inbound_received_quantity", "Inbound received"],
    ["reserved_transfer_quantity", "Reserved transfer"],
    ["reserved_processing_quantity", "Reserved processing"],
    ["reserved_customer_order_quantity", "Reserved customer orders"],
  ],
  health: [
    ["minimum_inventory_units", "Minimum inventory (units)"],
    ["days_of_supply", "Days of supply"],
    ["total_days_of_supply", "Total days of supply"],
  ],
  recommendation: [
    ["recommended_ship_in_units", "Recommended ship-in units"],
    ["recommended_ship_in_date", "Recommended ship-in date"],
  ],
  source: [
    ["capture_date", "Capture date"],
    ["snapshot_date", "Snapshot date"],
    ["report_created_at", "Report created"],
    ["preprocessed_at", "Preprocessed"],
  ],
} as const satisfies Record<string, readonly InventoryMetricDefinition[]>;
