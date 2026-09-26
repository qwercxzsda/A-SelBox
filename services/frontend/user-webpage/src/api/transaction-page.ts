import { parseExactCount } from "./content-range.ts";
import { DATASET_CONFIG } from "./config.ts";
import { datasetFilterValues } from "./filters.ts";
import { mapDatasetRows } from "./row-mappers.ts";
import type {
  TableDatasetKey,
  FetchDatasetCountOptions,
  FetchDatasetPageOptions,
  PageResult,
} from "./types.ts";
import { isJsonObject } from "./validation.ts";

type TransactionDataset = Extract<TableDatasetKey, "live" | "settlement" | "data_kiosk">;

export function isTransactionDataset(dataset: TableDatasetKey): dataset is TransactionDataset {
  return dataset === "live" || dataset === "settlement" || dataset === "data_kiosk";
}

/** Pages and counts must use the same validated filters and literal search term. */
export function transactionFilterArguments(
  options: FetchDatasetCountOptions & { dataset: TransactionDataset },
) {
  const filters = datasetFilterValues(options.dataset, options.filters);
  const common = {
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_skus: filters.selections.sku,
    p_marketplaces: filters.selections.marketplace_name,
    p_types: filters.selections.component_type,
    p_search: options.search.trim() || null,
  };
  return options.dataset === "live"
    ? {
        ...common,
        p_company_ids: filters.companyIds,
        p_sources: filters.selections.source,
        p_fee_applicable: filters.feeApplicable,
      }
    : { ...common, p_dataset: options.dataset };
}

export function transactionPageArguments(
  options: FetchDatasetPageOptions & { dataset: TransactionDataset },
) {
  return {
    ...transactionFilterArguments(options),
    p_limit: options.pageSize,
    p_offset: options.pageIndex * options.pageSize,
    p_direction: options.sort.direction,
    p_order_by:
      options.sort.column === DATASET_CONFIG[options.dataset].dateColumn ? "date" : "amount",
    p_include_count: options.includeCount ?? true,
  };
}

/** The RPC casts numerics to text so JSON parsing never rounds money or quantities. */
export function decodeTransactionPage(dataset: TableDatasetKey, value: unknown): PageResult {
  if (!isJsonObject(value) || !Array.isArray(value.rows)) {
    throw new Error("Transaction page returned invalid rows");
  }
  return {
    rows: mapDatasetRows(dataset, value.rows),
    totalCount: value.total_count === null ? null : parseExactCount(value.total_count),
  };
}
