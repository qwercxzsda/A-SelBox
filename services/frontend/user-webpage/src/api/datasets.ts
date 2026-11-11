import { DATASET_CONFIG, isTableDataset, type DatasetConfig } from "./config.ts";
import { parseTotalCount, parseExactCount } from "./content-range.ts";
import { datasetFilterValues } from "./filters.ts";
import { mapDatasetRows } from "./row-mappers.ts";
import { payoutSearchFilter } from "./payout-search.ts";
import { buildSearchFilter } from "./search.ts";
import {
  decodeTransactionPage,
  isTransactionDataset,
  transactionFilterArguments,
  transactionPageArguments,
} from "./transaction-page.ts";
import { ApiError, requireAccessToken, type ApiTransport } from "./transport.ts";
import { validatePagination } from "./pagination.ts";
import { isCurrency } from "./validation.ts";
import type {
  TableDatasetKey,
  DatasetSort,
  FetchDatasetPageOptions,
  FetchDatasetCountOptions,
  PageResult,
} from "./types.ts";

const SORT_DIRECTIONS: ReadonlySet<string> = new Set(["asc", "desc"]);

function datasetEndpoint(options: FetchDatasetCountOptions) {
  const config: DatasetConfig = DATASET_CONFIG[options.dataset];
  if (!config.endpoint) throw new Error("This dataset uses the transaction API");
  return config.endpoint;
}

function validatePageRequest(
  dataset: TableDatasetKey,
  pageIndex: number,
  pageSize: number,
  sort: DatasetSort,
): void {
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  validatePagination(pageIndex, pageSize);
  if (!SORT_DIRECTIONS.has(sort.direction)) throw new Error("Sort direction is invalid");
  if (!DATASET_CONFIG[dataset].sortColumns.some((column) => column === sort.column)) {
    throw new Error(`Sort column is not allowed for ${dataset}`);
  }
}

async function buildMembershipParams(
  transport: ApiTransport,
  options: FetchDatasetCountOptions,
): Promise<URLSearchParams> {
  const { dataset, search, filters } = options;
  if (options.includeSelbox !== undefined)
    throw new Error("SelBox selection is only available for Transactions");
  if (!isTableDataset(dataset)) throw new Error("Dataset is invalid");
  const params = new URLSearchParams();
  const values = datasetFilterValues(dataset, filters);
  if (values.companyIds.length) params.set("company_id", `in.(${values.companyIds.join(",")})`);
  if (options.currency !== undefined) {
    if (dataset !== "payouts" || !isCurrency(options.currency))
      throw new Error("A valid payout currency is required");
    params.set("currency", `eq.${options.currency}`);
  }
  if (dataset === "payouts") {
    if (values.selections.marketplace_name.length)
      params.set(
        "marketplace_name",
        `in.(${values.selections.marketplace_name.map((value) => JSON.stringify(value)).join(",")})`,
      );
    if (values.dateFrom) params.append("start_date", `gte.${values.dateFrom}`);
    if (values.dateTo) params.append("start_date", `lte.${values.dateTo}`);
  }
  const searchFilter =
    dataset === "payouts"
      ? await payoutSearchFilter(transport, options.accessToken, search, options.signal)
      : buildSearchFilter(DATASET_CONFIG[dataset].searchColumns, search);
  if (searchFilter !== null) params.set("or", searchFilter);
  return params;
}

async function buildDatasetParams(
  transport: ApiTransport,
  options: FetchDatasetPageOptions,
): Promise<URLSearchParams> {
  const { dataset, pageIndex, pageSize, sort } = options;
  const config = DATASET_CONFIG[dataset];
  const order = [
    `${sort.column}.${sort.direction}.nullslast`,
    ...(dataset === "payouts"
      ? ["company_id.asc", "marketplace_name.asc.nullslast", "currency.asc"]
      : []),
    ...config.idColumns.filter((column) => column !== sort.column).map((column) => `${column}.asc`),
  ];
  const params = await buildMembershipParams(transport, options);
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
      const params = await buildMembershipParams(transport, options);
      params.set("select", config.idColumns.join(","));
      params.set("limit", "0");
      params.set("offset", "0");
      return request(
        `/rest/v1/${datasetEndpoint(options)}?${params.toString()}`,
        {
          method: "HEAD",
          signal: options.signal,
          headers: {
            ...authenticatedHeaders(options.accessToken),
            Prefer: "count=exact",
          },
        },
        operation,
        (response) => {
          if (!response.ok) throw new ApiError(operation, response.status);
          const count = parseTotalCount(response.headers.get("Content-Range"));
          if (count === null) throw new Error("Record count was not returned");
          return count;
        },
      );
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
        datasetEndpoint(options),
        await buildDatasetParams(transport, options),
        config.label,
        options.signal,
        options.includeCount ?? true,
      );
      return { ...result, rows: mapDatasetRows(options.dataset, result.rows) };
    },
  };
}
