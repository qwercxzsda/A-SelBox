import { compareAmounts } from "../record-fixtures.mjs";

const REPORT_ENDPOINTS = {
  "/rest/v1/current_ad_invoices": "ad_invoices",
  "/rest/v1/current_storage_rows": "storage",
  "/rest/v1/current_aged_storage_rows": "aged_storage",
  "/rest/v1/current_removal_order_rows": "removal_orders",
};
const LINES_ENDPOINT = "/rest/v1/current_ad_invoice_lines";
const NUMERIC_COLUMNS = new Set(["amount_due", "fee_amount", "line_number"]);
const PAGING = new Set(["select", "order", "limit", "offset", "or"]);

/** The five administrator views of Amazon reports. */
export const RAW_DATA_PATHS = new Set([...Object.keys(REPORT_ENDPOINTS), LINES_ENDPOINT]);

function matchesFilter(row, column, filter) {
  const value = row[column] ?? null;
  if (filter.startsWith("in.(")) return JSON.parse(`[${filter.slice(4, -1)}]`).includes(value);
  if (filter.startsWith("eq.")) return value === filter.slice(3);
  if (filter.startsWith("gte.")) return value !== null && value >= filter.slice(4);
  if (filter.startsWith("lte.")) return value !== null && value <= filter.slice(4);
  throw new Error(`Unsupported raw data filter ${column}=${filter}`);
}

function matchesSearch(row, filter) {
  if (!filter) return true;
  return [...filter.matchAll(/(\w+)\.imatch\.("(?:\\.|[^"\\])*")/g)].some(([, column, pattern]) =>
    new RegExp(JSON.parse(pattern), "i").test(row[column] ?? ""),
  );
}

/** Emulate PostgREST filters, imatch search and ordering on the views' columns. */
function queryRawRows(rows, params) {
  const filters = [...params.entries()].filter(([column]) => !PAGING.has(column));
  const terms = (params.get("order") ?? "").split(",").filter(Boolean);
  return rows
    .filter(
      (row) =>
        filters.every(([column, filter]) => matchesFilter(row, column, filter)) &&
        matchesSearch(row, params.get("or")),
    )
    .sort((left, right) => {
      for (const term of terms) {
        const [column, direction] = term.split(".");
        const [a, b] = [left[column] ?? null, right[column] ?? null];
        if (a === b) continue;
        if (a === null || b === null) return a === null ? 1 : -1;
        const order = NUMERIC_COLUMNS.has(column) ? compareAmounts(a, b) : a < b ? -1 : 1;
        if (order !== 0) return direction === "desc" ? -order : order;
      }
      return 0;
    });
}

/** Members read the same views and get no rows, as the database's administrator gate does. */
export async function respondWithRawData(fixture, { request, url, user, csvReply, reply, track }) {
  const administrator = fixture.roles[user] === "administrator";
  const dataset = REPORT_ENDPOINTS[url.pathname] ?? "ad_invoice_lines";
  const entry = {
    user,
    dataset,
    params: url.searchParams,
    transport: "rest",
    endpoint: url.pathname,
    completed: false,
    failure: null,
  };
  track(request, entry);
  const counting = request.method() === "HEAD";
  (counting ? fixture.countRequests : fixture.requests).push(entry);
  if (!counting) await fixture.beforeDataset(entry);
  const status = fixture.datasetStatusForRequest?.(entry) ?? 200;
  if (status !== 200) return reply({ message: "Raw data fixture unavailable" }, status);
  const source = administrator
    ? ((dataset === "ad_invoice_lines" ? fixture.adInvoiceLines : fixture.rawRows?.[dataset]) ?? [])
    : [];
  const rows = queryRawRows(source, url.searchParams);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  return csvReply(
    url.searchParams.get("select").split(","),
    rows.slice(offset, offset + limit),
    rows.length,
    offset,
    request.headers().prefer?.includes("count=exact") ?? false,
  );
}
