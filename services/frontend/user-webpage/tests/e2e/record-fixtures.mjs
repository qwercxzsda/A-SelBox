const SELECTABLE_COLUMNS = new Set(["sku", "marketplace_name", "source", "component_type"]);
const DATE_COLUMNS = ["activity_date", "posted_date", "created_at"];
const NUMERIC_COLUMNS = new Set([
  "source_amount",
  "amount",
  "fee_rate_percent",
  "fee_amount",
  "company_amount",
]);

function matchesSearch(row, filter) {
  if (!filter) return true;
  return [...filter.matchAll(/(\w+)\.imatch\.("(?:\\.|[^"\\])*")/g)].some((match) =>
    new RegExp(JSON.parse(match[2]), "i").test(row[match[1]] ?? ""),
  );
}

/** Emulate only the documented REST filters used by browser fixtures. */
export function filterRecordRows(rows, params) {
  return rows.filter((row) => {
    if (params.get("amount") === "neq.0" && Number(row.amount) === 0) return false;
    if (
      params.get("and")?.includes("or(source.neq.DATA_KIOSK,source_amount.neq.0)") &&
      row.source === "DATA_KIOSK" &&
      Number(row.source_amount) === 0
    )
      return false;
    for (const key of SELECTABLE_COLUMNS) {
      for (const filter of params.getAll(key)) {
        if (filter.startsWith("in.(") && !JSON.parse(`[${filter.slice(4, -1)}]`).includes(row[key]))
          return false;
      }
    }
    for (const key of DATE_COLUMNS) {
      for (const filter of params.getAll(key)) {
        if (filter.startsWith("gte.") && row[key] < filter.slice(4)) return false;
        if (filter.startsWith("lte.") && row[key] > filter.slice(4)) return false;
      }
    }
    return matchesSearch(row, params.get("or"));
  });
}

export function sortRecordRows(rows, params) {
  const [column, direction] = (params.get("order") ?? "").split(".");
  return [...rows].sort((left, right) => {
    const comparison = NUMERIC_COLUMNS.has(column)
      ? Number(left[column]) - Number(right[column])
      : String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
    return direction === "desc" ? -comparison : comparison;
  });
}

export function optionColumn(params) {
  const selected = params.get("select");
  return SELECTABLE_COLUMNS.has(selected) ? selected : null;
}

export function projectedOptionRows(rows, column, params, pageCap) {
  const cursor = params
    .getAll(column)
    .find((filter) => filter.startsWith("gt."))
    ?.slice(3);
  return rows
    .filter(
      (row) =>
        row[column] !== null &&
        row[column] !== undefined &&
        (cursor === undefined || row[column] > cursor),
    )
    .map((row) => ({ [column]: row[column] }))
    .sort((left, right) => left[column].localeCompare(right[column]))
    .slice(0, Math.min(Number(params.get("limit")), pageCap));
}
