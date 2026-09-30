import { requireAccessToken, type ApiTransport } from "./transport.ts";
import { validatePagination } from "./pagination.ts";
import type { CanonicalRow } from "./types.ts";
import marketplaces from "../generated/marketplaces.json" with { type: "json" };

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

export interface FetchInventoryPageOptions {
  sku: string;
  marketplace: string;
  pageIndex: number;
  pageSize: number;
  accessToken: string;
  signal?: AbortSignal;
}

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

export function createInventoryApi(transport: ApiTransport) {
  return {
    async fetchInventoryPage(options: FetchInventoryPageOptions) {
      requireAccessToken(options.accessToken);
      const { sku, marketplace, pageIndex, pageSize } = options;
      validatePagination(pageIndex, pageSize);
      if (marketplace !== "" && !marketplaces.includes(marketplace))
        throw new Error("Inventory marketplace is invalid");
      if (sku.includes("\0")) throw new Error("Inventory SKU is invalid");
      const params = new URLSearchParams({
        select: INVENTORY_COLUMNS.join(","),
        order: "sku.asc,marketplace_name.asc,capture_id.asc",
        limit: String(pageSize),
        offset: String(pageIndex * pageSize),
      });
      // Direct eq values are literal; URLSearchParams encodes spaces and punctuation.
      if (sku !== "") params.set("sku", "eq." + sku);
      if (marketplace !== "") params.set("marketplace_name", "eq." + marketplace);
      const result = await transport.readCsvPage(
        options.accessToken,
        "latest_inventory_items",
        params,
        "Inventory",
        options.signal,
      );
      return { ...result, rows: result.rows.map(decodeInventoryRow) };
    },
  };
}
