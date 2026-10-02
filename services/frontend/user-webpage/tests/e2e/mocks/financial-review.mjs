import { filterRecordRows, sortRecordRows } from "../record-fixtures.mjs";

const COLUMNS = {
  financial_review_totals: [
    "month",
    "category",
    "currency",
    "settlement_amount",
    "data_kiosk_amount",
    "difference",
    "settlement_row_count",
    "data_kiosk_row_count",
  ],
  financial_review_type_totals: [
    "month",
    "category",
    "currency",
    "source",
    "component_type",
    "amount",
    "row_count",
  ],
  financial_review_records: [
    "source",
    "source_row_id",
    "source_version_id",
    "activity_date",
    "seller_namespace",
    "marketplace_name",
    "sku",
    "component_type",
    "category",
    "currency",
    "amount",
  ],
};
const DATA = {
  financial_review_totals: "financialReviewTotals",
  financial_review_type_totals: "financialReviewTypeTotals",
  financial_review_records: "financialReviewRecords",
};

export async function respondWithFinancialReview(
  fixture,
  { request, url, user, reply, csvReply, track },
) {
  const endpoint = url.pathname.split("/").at(-1);
  const entry = { endpoint, params: url.searchParams, user, completed: false };
  fixture.financialReviewRequests.push(entry);
  track(request, entry);
  if (fixture.roles[user] !== "operator") return reply({}, 403);
  await fixture.beforeFinancialReview(entry);
  const status = fixture.financialReviewStatusForRequest?.(entry) ?? fixture.financialReviewStatus;
  if (status !== 200) return reply({}, status);
  const filters = new URLSearchParams(url.searchParams);
  const category = filters.get("p_category");
  if (category) filters.set("category", `eq.${category}`);
  const currency = filters.get("p_currency");
  if (currency) filters.set("currency", `eq.${currency}`);
  const from = filters.get("p_month_from");
  const to = filters.get("p_month_to");
  if (from) filters.append("month", `gte.${from}`);
  if (to) filters.append("month", `lt.${to}`);
  const isAnchor =
    endpoint === "financial_review_records" && filters.get("select") === "activity_date";
  const sourceRows = isAnchor
    ? fixture.financialReviewTotals.map((row) => ({ ...row, activity_date: row.month }))
    : fixture[DATA[endpoint]];
  for (const [, field, operator, date] of (filters.get("and") ?? "").matchAll(
    /(month|activity_date)\.(eq|gte|lte|gt|lt)\.([0-9-]+)/g,
  ))
    filters.append(field, `${operator}.${date}`);
  const rows = sortRecordRows(
    filterRecordRows(sourceRows, filters).filter((row) => {
      if (filters.get("category") !== `eq.${row.category}`) return false;
      const before = filters.get("activity_date");
      if (before?.startsWith("lt.") && row.activity_date >= before.slice(3)) return false;
      return filters.getAll("month").every((filter) => {
        const [operator, value] = filter.split(".");
        if (operator === "eq") return row.month === value;
        if (operator === "gte") return row.month >= value;
        if (operator === "lte") return row.month <= value;
        if (operator === "gt") return row.month > value;
        if (operator === "lt") return row.month < value;
        throw new Error(`Unsupported review month filter: ${filter}`);
      });
    }),
    filters,
  );
  const offset = Number(filters.get("offset") ?? 0);
  const limit = Number(filters.get("limit") ?? rows.length);
  const selected = filters.get("select");
  const columns = selected && selected !== "*" ? selected.split(",") : COLUMNS[endpoint];
  return csvReply(columns, rows.slice(offset, offset + limit), rows.length, offset);
}
