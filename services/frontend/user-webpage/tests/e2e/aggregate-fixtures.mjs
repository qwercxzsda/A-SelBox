import { sumExactDecimals } from "../../src/decimal.ts";

export function latestBucketDate(rows) {
  return rows.reduce(
    (latest, row) => (row.activity_date > (latest ?? "") ? row.activity_date : latest),
    null,
  );
}

export function periodBucketTotals(rows, params) {
  const bounds = params.getAll("activity_date");
  if (!bounds.some((bound) => bound.startsWith("gte.") || bound.startsWith("lte."))) {
    throw new Error("Browser summary requests must have a date bound");
  }
  const matching = rows.filter((row) =>
    bounds.every((bound) =>
      bound.startsWith("gte.")
        ? row.activity_date >= bound.slice(4)
        : bound.startsWith("lte.")
          ? row.activity_date <= bound.slice(4)
          : true,
    ),
  );
  const currencies = [...new Set(matching.map((row) => row.currency))].sort();
  return currencies.map((currency) => {
    const group = matching.filter((row) => row.currency === currency);
    return {
      currency,
      reported_amount: sumExactDecimals(group.map((row) => row.reported_amount)),
      service_fee: sumExactDecimals(group.map((row) => row.service_fee)),
      company_amount: sumExactDecimals(group.map((row) => row.company_amount)),
      row_count: group.reduce((count, row) => count + BigInt(row.row_count), 0n).toString(),
      known_company_count: group
        .reduce((count, row) => count + BigInt(row.known_company_count), 0n)
        .toString(),
    };
  });
}
