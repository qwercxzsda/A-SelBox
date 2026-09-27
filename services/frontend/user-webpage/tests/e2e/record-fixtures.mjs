const SELECTABLE_COLUMNS = new Set(["sku", "marketplace_name", "source", "component_type"]);
const DATE_COLUMNS = ["activity_date", "posted_date", "created_at"];
const NUMERIC_COLUMNS = new Set(["amount", "source_amount", "company_amount"]);

function decimalParts(value) {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value))
    throw new Error("Expected canonical decimal fixture text");
  const [integer, fraction = ""] = value.split(".");
  return { coefficient: BigInt(integer + fraction), scale: fraction.length };
}

function compareAmounts(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const difference =
    a.coefficient * 10n ** BigInt(scale - a.scale) - b.coefficient * 10n ** BigInt(scale - b.scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function isZeroAmount(value) {
  return value !== null && value !== undefined && compareAmounts(value, "0") === 0;
}

function matchesSearch(row, filter) {
  if (!filter) return true;
  if (filter.startsWith("{"))
    return Object.entries(JSON.parse(filter)).some(([field, values]) =>
      values.includes(row[field]),
    );
  return [...filter.matchAll(/(\w+)\.imatch\.("(?:\\.|[^"\\])*")/g)].some((match) => {
    const pattern = new RegExp(JSON.parse(match[2]), "i");
    const field = match[1];
    const sourceLabel = { SETTLEMENT: "Settlements", DATA_KIOSK: "Data Kiosk" }[row.source];
    return (
      pattern.test(row[field] ?? "") ||
      (field === "source" && sourceLabel !== undefined && pattern.test(sourceLabel))
    );
  });
}

/** Emulate the documented REST filters and RPC fee selection used by browser fixtures. */
export function filterRecordRows(rows, params) {
  return rows.filter((row) => {
    const feeSelection = params.get("fee_applicable");
    if (feeSelection !== null) {
      const applicable =
        (row.source === "SETTLEMENT" &&
          ["PRODUCT_SALES", "PRODUCT_REFUNDS"].includes(row.component_type)) ||
        (row.source === "DATA_KIOSK" && row.component_type === "NET_PRODUCT_SALES");
      if (applicable !== (feeSelection === "true")) return false;
    }
    const company = params.get("company_id");
    if (company?.startsWith("eq.") && row.company_id !== company.slice(3)) return false;
    if (company?.startsWith("in.(") && !company.slice(4, -1).split(",").includes(row.company_id))
      return false;
    if (params.get("amount") === "neq.0" && (row.amount === null || isZeroAmount(row.amount)))
      return false;
    if (
      params.get("and")?.includes("or(source.neq.DATA_KIOSK,source_amount.neq.0)") &&
      row.source === "DATA_KIOSK" &&
      (row.source_amount === null || isZeroAmount(row.source_amount))
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
        if (
          filter.startsWith("gte.") &&
          (row[key] === null || row[key] === undefined || row[key] < filter.slice(4))
        )
          return false;
        if (
          filter.startsWith("lte.") &&
          (row[key] === null || row[key] === undefined || row[key] > filter.slice(4))
        )
          return false;
      }
    }
    return matchesSearch(row, params.get("or"));
  });
}

export function sortRecordRows(rows, params) {
  const terms = (params.get("order") ?? "").split(",").map((term) => term.split("."));
  return [...rows].sort((left, right) => {
    for (const [column, direction, nulls] of terms) {
      const a = left[column];
      const b = right[column];
      const aIsNull = a === null || a === undefined;
      const bIsNull = b === null || b === undefined;
      if (aIsNull || bIsNull) {
        if (aIsNull && bIsNull) continue;
        const nullsLast = nulls === "nullslast" || (nulls === undefined && direction !== "desc");
        return (aIsNull ? 1 : -1) * (nullsLast ? 1 : -1);
      }
      const comparison = NUMERIC_COLUMNS.has(column)
        ? compareAmounts(a, b)
        : a < b
          ? -1
          : a > b
            ? 1
            : 0;
      if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}
