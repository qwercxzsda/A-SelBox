import type { ApiTransport } from "./transport.ts";
import { readAllCsvRows } from "./pagination.ts";
import { requireCalendarDate } from "./filters.ts";
import { readStableSnapshot } from "./snapshot.ts";
import type { AppAccount, CanonicalRow } from "./types.ts";
import marketplaces from "../generated/marketplaces.json" with { type: "json" };

export const INVENTORY_CAPTURE_COLUMNS = [
  "capture_id",
  "marketplace_name",
  "capture_date",
  "report_created_at",
  "preprocessed_at",
] as const;
export type InventoryCapture = Record<(typeof INVENTORY_CAPTURE_COLUMNS)[number], string>;

export const INVENTORY_COLUMNS = [
  "capture_id",
  "capture_date",
  "marketplace_name",
  "sku",
  "company_id",
  "report_created_at",
  "preprocessed_at",
  "snapshot_date",
  "available_quantity",
  "fba_supply_quantity",
  "inbound_quantity",
  "inbound_working_quantity",
  "inbound_shipped_quantity",
  "inbound_received_quantity",
  "reserved_quantity",
  "reserved_transfer_quantity",
  "reserved_processing_quantity",
  "reserved_customer_order_quantity",
  "unfulfillable_quantity",
  "sales_amount_90d",
  "units_shipped_90d",
  "currency",
  "health_status",
  "minimum_inventory_units",
  "days_of_supply",
  "total_days_of_supply",
  "recommended_ship_in_units",
  "recommended_ship_in_date",
  "recommended_action",
] as const;

type InventoryColumn = (typeof INVENTORY_COLUMNS)[number];
export type InventoryRow = Record<InventoryColumn, string | null> & {
  capture_id: string;
  capture_date: string;
  marketplace_name: string;
  sku: string;
  report_created_at: string;
  preprocessed_at: string;
};

function decodeInventoryRow(row: CanonicalRow): InventoryRow {
  if (INVENTORY_COLUMNS.some((column) => !(column in row)))
    throw new Error("Inventory returned an incomplete row");
  for (const column of [
    "capture_id",
    "capture_date",
    "marketplace_name",
    "sku",
    "report_created_at",
    "preprocessed_at",
  ])
    if (typeof row[column] !== "string" || !row[column].trim())
      throw new Error("Inventory returned an invalid identity or source date");
  return row as InventoryRow;
}

function requireMarketplace(marketplace: string): void {
  if (marketplace !== "" && !marketplaces.includes(marketplace))
    throw new Error("Inventory marketplace is invalid");
}

function decodeInventoryCapture(row: CanonicalRow): InventoryCapture {
  if (
    INVENTORY_CAPTURE_COLUMNS.some(
      (column) => typeof row[column] !== "string" || !row[column].trim(),
    )
  )
    throw new Error("Inventory returned an incomplete capture reference");
  const capture = row as InventoryCapture;
  requireCalendarDate(capture.capture_date);
  requireMarketplace(capture.marketplace_name);
  return capture;
}

export function createInventoryApi(transport: ApiTransport) {
  return {
    fetchInventoryCaptures(accessToken: string, signal?: AbortSignal): Promise<InventoryCapture[]> {
      return readAllCsvRows(transport, {
        accessToken,
        signal,
        endpoint: "latest_inventory_captures",
        columns: INVENTORY_CAPTURE_COLUMNS,
        order: "marketplace_name.asc,capture_id.asc",
        operation: "Inventory availability",
        decode: decodeInventoryCapture,
        identity: (capture) => capture.capture_id,
      });
    },
    fetchInventoryRows(
      accessToken: string,
      expectedAccount: AppAccount,
      signal?: AbortSignal,
    ): Promise<InventoryRow[]> {
      return readStableSnapshot(
        transport,
        {
          accessToken,
          expectedAccount,
          sources: ["fees", "inventory"],
          operation: "Inventory",
          signal,
        },
        () =>
          readAllCsvRows(transport, {
            accessToken,
            signal,
            endpoint: "latest_inventory_items",
            columns: INVENTORY_COLUMNS,
            order: "capture_id.asc,sku.asc",
            operation: "Inventory",
            decode: decodeInventoryRow,
            identity: (row) => JSON.stringify([row.capture_id, row.sku]),
          }),
      );
    },
  };
}
