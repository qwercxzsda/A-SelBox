import { requireAccessToken, type ApiTransport } from "./transport.ts";
import { validatePagination } from "./pagination.ts";
import type { CanonicalRow } from "./types.ts";
import marketplaces from "../generated/marketplaces.json" with { type: "json" };
import { isJsonObject } from "./validation.ts";

export const INVENTORY_SORT_COLUMNS = [
  "sku",
  "sales_amount_90d",
  "health_status",
  "recommended_action",
] as const;
export type InventorySortColumn = (typeof INVENTORY_SORT_COLUMNS)[number];
const INVENTORY_ORDER_COLUMNS = {
  sku: "sku",
  sales_amount_90d: "sales_amount_90d",
  health_status: "health_status_urgency",
  recommended_action: "recommended_action_urgency",
} satisfies Record<InventorySortColumn, string>;
export interface InventoryFilterOptions {
  skus: string[];
  health_statuses: (string | null)[];
  recommendations: (string | null)[];
}
export interface InventorySearchValues extends InventoryFilterOptions {
  marketplaces: string[];
}

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
  search: string;
  searchValues?: InventorySearchValues | null;
  skus: string[];
  healthStatuses: (string | null)[];
  recommendations: (string | null)[];
  marketplace: string;
  sortColumn: InventorySortColumn;
  sortDirection: "asc" | "desc";
  pageIndex: number;
  pageSize: number;
  accessToken: string;
  signal?: AbortSignal;
}

function selection(value: unknown, nullable = true): (string | null)[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry: unknown) =>
        !(nullable && entry === null) &&
        (typeof entry !== "string" || entry.includes("\0") || (!nullable && entry.length === 0)),
    )
  )
    throw new Error("Inventory filter values are invalid");
  return [...new Set(value as (string | null)[])];
}

/** Quoted PostgREST values preserve punctuation; null remains a distinct filter choice. */
function selectionExpression(column: string, values: (string | null)[]): string {
  const text = values.filter((value): value is string => value !== null);
  const quoted = text.map((value) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
  const expressions = [
    ...(text.length ? [`${column}.in.(${quoted.join(",")})`] : []),
    ...(values.includes(null) ? [`${column}.is.null`] : []),
  ];
  return expressions.length === 1 ? expressions[0] : `or(${expressions.join(",")})`;
}

function inventoryFilterParams(options: FetchInventoryPageOptions): URLSearchParams {
  const clauses: string[] = [];
  for (const [column, selected, nullable] of [
    ["sku", options.skus, false],
    ["health_status", options.healthStatuses, true],
    ["recommended_action", options.recommendations, true],
  ] as const) {
    const values = selection(selected, nullable);
    if (values.length) clauses.push(selectionExpression(column, values));
  }
  if (typeof options.search !== "string" || options.search.includes("\0"))
    throw new Error("Inventory search is invalid");
  if (options.search.trim()) {
    if (!isJsonObject(options.searchValues))
      throw new Error("Resolve inventory search before loading rows");
    const expressions = [
      ["sku", selection(options.searchValues.skus, false)],
      ["health_status", selection(options.searchValues.health_statuses)],
      ["recommended_action", selection(options.searchValues.recommendations)],
      ["marketplace_name", selection(options.searchValues.marketplaces, false)],
    ] as const;
    const matches = expressions
      .filter(([, values]) => values.length)
      .map(([column, values]) => selectionExpression(column, values));
    // A search with no catalog matches must not become an unrestricted read.
    clauses.push(matches.length ? `or(${matches.join(",")})` : "sku.is.null");
  } else if (options.searchValues)
    throw new Error("Empty inventory search cannot include search values");
  const params = new URLSearchParams();
  if (clauses.length) params.set("and", `(${clauses.join(",")})`);
  return params;
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
    async fetchInventoryFilterOptions(
      accessToken: string,
      signal?: AbortSignal,
    ): Promise<InventoryFilterOptions> {
      const value = await transport.postRpc(
        accessToken,
        "inventory_filter_options",
        {},
        "Inventory filter options",
        signal,
      );
      if (!isJsonObject(value)) throw new Error("Inventory returned invalid filter options");
      return {
        skus: selection(value.skus, false) as string[],
        health_statuses: selection(value.health_statuses),
        recommendations: selection(value.recommendations),
      };
    },
    async fetchInventoryPage(options: FetchInventoryPageOptions) {
      requireAccessToken(options.accessToken);
      const { marketplace, pageIndex, pageSize, sortColumn, sortDirection } = options;
      validatePagination(pageIndex, pageSize);
      if (marketplace !== "" && !marketplaces.includes(marketplace))
        throw new Error("Inventory marketplace is invalid");
      if (!INVENTORY_SORT_COLUMNS.includes(sortColumn) || !["asc", "desc"].includes(sortDirection))
        throw new Error("Inventory sort is invalid");
      const params = inventoryFilterParams(options);
      params.set("select", INVENTORY_COLUMNS.join(","));
      params.set(
        "order",
        [
          `${INVENTORY_ORDER_COLUMNS[sortColumn]}.${sortDirection}.nullslast`,
          ...["sku", "marketplace_name", "capture_id"]
            .filter((column) => column !== sortColumn)
            .map((column) => `${column}.asc`),
        ].join(","),
      );
      params.set("limit", String(pageSize));
      params.set("offset", String(pageIndex * pageSize));
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
