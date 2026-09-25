import { DATASET_CONFIG } from "../../src/api/config.ts";
import { buildSearchFilter } from "../../src/api/search.ts";

/** Expose the RPC's query semantics to the shared table fixtures and assertions. */
export function transactionPageParams(args) {
  const params = transactionFilterParams(args);
  params.set("limit", String(args.p_limit));
  params.set("offset", String(args.p_offset));
  const column = args.p_order_by === "amount" ? "source_amount" : "activity_date";
  const tieDirection = args.p_order_by === "amount" ? "asc" : args.p_direction;
  params.set(
    "order",
    `${column}.${args.p_direction}.nullslast,source.${tieDirection},source_row_id.${tieDirection}`,
  );
  return params;
}

export function sourceTransactionPageParams(args) {
  const params = sourceTransactionFilterParams(args);
  const date = args.p_dataset === "settlement" ? "posted_date" : "activity_date";
  params.set("limit", String(args.p_limit));
  params.set("offset", String(args.p_offset));
  const column = args.p_order_by === "amount" ? "amount" : date;
  const tieDirection = args.p_order_by === "amount" ? "asc" : args.p_direction;
  params.set("order", `${column}.${args.p_direction}.nullslast,id.${tieDirection}`);
  return params;
}

export function sourceTransactionFilterParams(args) {
  const date = args.p_dataset === "settlement" ? "posted_date" : "activity_date";
  const params = new URLSearchParams();
  addSearch(params, args.p_dataset, args.p_search);
  if (args.p_dataset === "data_kiosk") params.set("amount", "neq.0");
  if (args.p_date_from) params.append(date, `gte.${args.p_date_from}`);
  if (args.p_date_to) params.append(date, `lte.${args.p_date_to}`);
  for (const [field, values] of [
    ["sku", args.p_skus],
    ["marketplace_name", args.p_marketplaces],
    ["component_type", args.p_types],
  ]) {
    if (values.length > 0) params.set(field, `in.(${values.map(JSON.stringify).join(",")})`);
  }
  return params;
}

export function transactionFilterParams(args) {
  const params = new URLSearchParams({ and: "(or(source.neq.DATA_KIOSK,source_amount.neq.0))" });
  addSearch(params, "live", args.p_search);
  if (args.p_fee_applicable !== null) params.set("fee_applicable", String(args.p_fee_applicable));
  if (args.p_date_from) params.append("activity_date", `gte.${args.p_date_from}`);
  if (args.p_date_to) params.append("activity_date", `lte.${args.p_date_to}`);
  if (args.p_company_ids.length > 0)
    params.set("company_id", `in.(${[...args.p_company_ids].sort().join(",")})`);
  for (const [field, values] of [
    ["sku", args.p_skus],
    ["marketplace_name", args.p_marketplaces],
    ["source", args.p_sources],
    ["component_type", args.p_types],
  ]) {
    if (values.length > 0) params.set(field, `in.(${values.map(JSON.stringify).join(",")})`);
  }
  return params;
}

function addSearch(params, dataset, term) {
  const filter = buildSearchFilter(DATASET_CONFIG[dataset].searchColumns, term ?? "");
  if (filter !== null) params.set("or", filter);
}
