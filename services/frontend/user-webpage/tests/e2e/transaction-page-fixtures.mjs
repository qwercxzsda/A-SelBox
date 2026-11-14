/** Expose the RPC's query semantics to the shared table fixtures and assertions. */
export function transactionPageParams(args) {
  const params = transactionFilterParams(args);
  params.set("limit", String(args.p_limit));
  params.set("offset", String(args.p_offset));
  const column = args.p_order_by === "amount" ? "source_amount" : "activity_at";
  const tieDirection = args.p_order_by === "amount" ? "asc" : args.p_direction;
  const nulls =
    args.p_order_by !== "amount" && args.p_direction === "desc" ? "nullsfirst" : "nullslast";
  params.set(
    "order",
    `${column}.${args.p_direction}.${nulls},source.${tieDirection},source_row_id.${tieDirection}`,
  );
  return params;
}

export function sourceTransactionPageParams(args) {
  const params = sourceTransactionFilterParams(args);
  params.set("limit", String(args.p_limit));
  params.set("offset", String(args.p_offset));
  const column = args.p_order_by === "amount" ? "amount" : "activity_at";
  const tieDirection = args.p_order_by === "amount" ? "asc" : args.p_direction;
  const nulls =
    args.p_order_by !== "amount" && args.p_direction === "desc" ? "nullsfirst" : "nullslast";
  params.set("order", `${column}.${args.p_direction}.${nulls},id.${tieDirection}`);
  return params;
}

export function sourceTransactionFilterParams(args) {
  const params = new URLSearchParams();
  addSearch(params, args);
  if (args.p_dataset === "data_kiosk") params.set("amount", "not.is.null");
  addUtcDates(params, args);
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
  const params = new URLSearchParams();
  addSearch(params, args);
  if (args.p_currency) params.set("currency", `eq.${args.p_currency}`);
  if (args.p_fee_applicable !== null) params.set("fee_applicable", String(args.p_fee_applicable));
  addUtcDates(params, args);
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

function addSearch(params, args) {
  if ("p_search" in args) throw new Error("Transaction search must use exact value arrays");
  const values = {
    sku: args.p_search_skus,
    component_type: args.p_search_types,
    marketplace_name: args.p_search_marketplaces,
    ...(Object.hasOwn(args, "p_search_sources") ? { source: args.p_search_sources } : {}),
  };
  if (Object.values(values).some((selection) => selection !== null)) {
    if (Object.values(values).some((selection) => !Array.isArray(selection)))
      throw new Error("Active transaction searches require all exact value arrays");
    params.set("or", JSON.stringify(values));
  }
}

function addUtcDates(params, args) {
  if (args.p_date_from) params.append("activity_at", `gte.${args.p_date_from}T00:00:00.000000Z`);
  if (args.p_date_to) {
    const next = new Date(`${args.p_date_to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    params.append("activity_at", `lt.${next.toISOString().replace(".000Z", ".000000Z")}`);
  }
}
