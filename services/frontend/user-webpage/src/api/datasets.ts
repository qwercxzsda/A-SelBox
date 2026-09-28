import { DATASET_CONFIG, isTableDataset } from "./config.ts";
import { parseTotalCount, parseExactCount } from "./content-range.ts";
import { datasetFilterValues } from "./filters.ts";
import { mapDatasetRows } from "./row-mappers.ts";
import { buildSearchFilter } from "./search.ts";
import {
  decodeTransactionPage,
  isTransactionDataset,
  transactionFilterArguments,
  transactionPageArguments,
} from "./transaction-page.ts";
import { ApiError, requireAccessToken, type ApiTransport } from "./transport.ts";
import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import type {
  TableDatasetKey,
  DatasetSort,
  FetchDatasetPageOptions,
  FetchDatasetCountOptions,
  PageResult,
} from "./types.ts";

const SORT_DIRECTIONS: ReadonlySet<string> = new Set(["asc", "desc"]);

function validatePageRequest(
  dataset: TableDatasetKey,
  pageIndex: number,
  pageSize: number,
  sort: DatasetSort,
): void {
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("Page index must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > LOOKUP_PAGE_SIZE) {
    throw new Error("Page size must be a positive integer of at most 1000");
  }
  if (!SORT_DIRECTIONS.has(sort.direction)) throw new Error("Sort direction is invalid");
  if (!DATASET_CONFIG[dataset].sortColumns.some((column) => column === sort.column)) {
    throw new Error(`Sort column is not allowed for ${dataset}`);
  }
  if (!Number.isSafeInteger(pageIndex * pageSize)) {
    throw new Error("Page offset exceeds JavaScript's safe range");
  }
}

function buildMembershipParams(options: FetchDatasetCountOptions): URLSearchParams {
  const { dataset, search, filters } = options;
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  const params = new URLSearchParams();
  const searchFilter = buildSearchFilter(DATASET_CONFIG[dataset].searchColumns, search);
  if (searchFilter !== null) params.set("or", searchFilter);
  const values = datasetFilterValues(dataset, filters);
  if (dataset === "payouts") {
    if (values.companyIds.length) params.set("company_id", `in.(${values.companyIds.join(",")})`);
    if (values.dateFrom) params.append("start_date", `gte.${values.dateFrom}`);
    if (values.dateTo) params.append("start_date", `lte.${values.dateTo}`);
  }
  return params;
}

function buildDatasetParams(options: FetchDatasetPageOptions): URLSearchParams {
  const { dataset, pageIndex, pageSize, sort } = options;
  const config = DATASET_CONFIG[dataset];
  const order = [
    `${sort.column}.${sort.direction}.nullslast`,
    ...config.idColumns.filter((column) => column !== sort.column).map((column) => `${column}.asc`),
  ];
  const params = buildMembershipParams(options);
  params.set("select", config.selectColumns.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String(pageIndex * pageSize));
  params.set("order", order.join(","));
  return params;
}

export function createDatasetApi(transport: ApiTransport) {
  const { request, postRpc, authenticatedHeaders, readCsvPage } = transport;
  return {
    async fetchDatasetCount(options: FetchDatasetCountOptions): Promise<number> {
      requireAccessToken(options.accessToken);
      const { dataset } = options;
      if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
      const operation = `${DATASET_CONFIG[dataset].label} count`;
      if (isTransactionDataset(dataset)) {
        return parseExactCount(
          await postRpc(
            options.accessToken,
            dataset === "live" ? "transaction_count" : "source_transaction_count",
            transactionFilterArguments({ ...options, dataset }),
            operation,
            options.signal,
          ),
        );
      }
      const config = DATASET_CONFIG[dataset];
      const params = buildMembershipParams(options);
      params.set("select", config.idColumns.join(","));
      params.set("limit", "0");
      params.set("offset", "0");
      const response = await request(
        `/rest/v1/${config.endpoint}?${params.toString()}`,
        {
          method: "HEAD",
          signal: options.signal,
          headers: {
            ...authenticatedHeaders(options.accessToken),
            Prefer: "count=exact",
          },
        },
        operation,
      );
      if (!response.ok) throw new ApiError(operation, response.status);
      const count = parseTotalCount(response.headers.get("Content-Range"));
      if (count === null) throw new Error("Record count was not returned");
      return count;
    },

    async fetchDatasetPage(options: FetchDatasetPageOptions): Promise<PageResult> {
      requireAccessToken(options.accessToken);
      validatePageRequest(options.dataset, options.pageIndex, options.pageSize, options.sort);
      const { dataset } = options;
      if (isTransactionDataset(dataset)) {
        return decodeTransactionPage(
          options.dataset,
          await postRpc(
            options.accessToken,
            options.dataset === "live" ? "transaction_page" : "source_transaction_page",
            transactionPageArguments({ ...options, dataset }),
            DATASET_CONFIG[dataset].label,
            options.signal,
          ),
        );
      }
      const config = DATASET_CONFIG[dataset];
      const result = await readCsvPage(
        options.accessToken,
        config.endpoint,
        buildDatasetParams(options),
        config.label,
        options.signal,
        options.includeCount ?? true,
      );
      return { ...result, rows: mapDatasetRows(options.dataset, result.rows) };
    },
  };
}
