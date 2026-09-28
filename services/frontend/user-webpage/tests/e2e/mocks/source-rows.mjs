import { DATA_KIOSK_COLUMNS, SETTLEMENT_COLUMNS } from "../api-fixtures.mjs";
import { filterRecordRows, sortRecordRows } from "../record-fixtures.mjs";
import { sourceTransactionPageParams } from "../transaction-page-fixtures.mjs";
import { amountOrderLimitExceeded, AMOUNT_ORDER_LIMIT_RESPONSE } from "./amount-ordering.mjs";

export async function respondWithSourceRows(fixture, { request, url, user, reply, track }) {
  if (url.pathname === "/rest/v1/rpc/source_transaction_page") {
    const args = request.postDataJSON();
    url.search = sourceTransactionPageParams(args).toString();
    const settlement = args.p_dataset === "settlement";
    const dataset = settlement ? "settlement" : "data_kiosk";
    const sourceRows = settlement ? fixture.settlementRows : fixture.kioskRows;
    const entry = {
      user,
      params: url.searchParams,
      dataset,
      args,
      transport: "rpc",
      completed: false,
      failure: null,
    };
    track(request, entry);
    fixture.requests.push(entry);
    await fixture.beforeDataset(entry);
    const status = fixture.datasetStatusForRequest?.(entry) ?? 200;
    if (status !== 200) return reply({ message: "Dataset fixture unavailable" }, status);
    const rows = sortRecordRows(filterRecordRows(sourceRows, url.searchParams), url.searchParams);
    if (amountOrderLimitExceeded(fixture, entry, rows.length))
      return reply(AMOUNT_ORDER_LIMIT_RESPONSE, 400);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const columns = settlement ? SETTLEMENT_COLUMNS : DATA_KIOSK_COLUMNS;
    return reply({
      rows: rows
        .slice(offset, offset + limit)
        .map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))),
      total_count: args.p_include_count ? String(rows.length) : null,
    });
  }

  throw new Error(`Unexpected source request: ${url.pathname}`);
}
