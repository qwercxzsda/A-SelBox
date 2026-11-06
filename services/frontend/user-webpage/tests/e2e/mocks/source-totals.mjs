import { sumExactDecimals } from "../../../src/decimal.ts";

const SOURCES = ["FINANCES", "DATA_KIOSK"];
const CATEGORIES = new Set(["FINANCES", "DATA_KIOSK", "SELBOX"]);

export function sourceRequestParams(args) {
  return new URLSearchParams(
    Object.entries(args)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

/** Group native fixture values exactly as the aggregate wire contract does. */
export function sourceTotalsResponse(rows, scope, args, revision, coverage = null) {
  const grouping = args.p_grouping ?? "total";
  const scoped = rows.filter(
    (row) =>
      SOURCES.includes(row.source) &&
      CATEGORIES.has(row.category) &&
      row.marketplace_name === scope.marketplace_name &&
      (scope.currency === null || row.currency === scope.currency) &&
      (!args.p_category || row.category === args.p_category) &&
      row.activity_date >= scope.start_date &&
      row.activity_date <= scope.end_date &&
      BigInt(row.row_count ?? "1") > 0n,
  );
  const buckets = new Map();
  for (const row of scoped) {
    const seller = grouping === "day" ? row.seller_namespace : null;
    const period =
      grouping === "total"
        ? null
        : grouping === "month"
          ? `${row.activity_date.slice(0, 7)}-01`
          : row.activity_date;
    const key = JSON.stringify([seller, period, row.marketplace_name, row.currency]);
    const bucket = buckets.get(key) ?? new Map();
    const component = `${row.source}:${row.category}`;
    const previous = bucket.get(component);
    bucket.set(component, {
      seller_namespace: seller,
      period,
      marketplace_name: row.marketplace_name,
      currency: row.currency,
      source: row.source,
      category: row.category,
      amount: sumExactDecimals([previous?.amount ?? "0", row.amount]),
      row_count: (BigInt(previous?.row_count ?? "0") + BigInt(row.row_count ?? "1")).toString(),
    });
    buckets.set(key, bucket);
  }
  const ordered = [...buckets.values()].sort((left, right) => {
    const a = left.values().next().value;
    const b = right.values().next().value;
    return (
      (a.period ?? "").localeCompare(b.period ?? "") ||
      (a.seller_namespace ?? "").localeCompare(b.seller_namespace ?? "") ||
      (a.marketplace_name ?? "").localeCompare(b.marketplace_name ?? "") ||
      a.currency.localeCompare(b.currency)
    );
  });
  const offset = grouping === "day" ? Number(args.p_offset ?? 0) : 0;
  const limit = grouping === "day" ? Number(args.p_limit ?? 50) : ordered.length;
  const selected = ordered.slice(offset, offset + limit);
  const sellers = [...new Set(scoped.map((row) => row.seller_namespace ?? "seller-one"))];
  const evidence =
    coverage ??
    (sellers.length ? sellers : ["seller-one"]).flatMap((seller) =>
      SOURCES.map((source) => ({
        source,
        seller_namespace: seller,
        start_date: scope.start_date,
        end_date: scope.end_date,
      })),
    );
  return {
    scope,
    revision,
    rows: selected.flatMap((bucket) => [...bucket.values()]),
    coverage: evidence
      .filter((row) => row.start_date <= scope.end_date && row.end_date >= scope.start_date)
      .map((row) => ({
        ...row,
        start_date: row.start_date < scope.start_date ? scope.start_date : row.start_date,
        end_date: row.end_date > scope.end_date ? scope.end_date : row.end_date,
      })),
    total_count: String(ordered.length),
    next_offset:
      grouping === "day" && offset + selected.length < ordered.length
        ? offset + selected.length
        : null,
  };
}
