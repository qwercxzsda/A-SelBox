import { sumExactDecimals } from "../../src/decimal.ts";
import { filterRecordRows } from "./record-fixtures.mjs";

export function periodBucketTotals(rows, params) {
  const bounds = params.getAll("activity_at");
  if (!bounds.some((bound) => /^(gte|lte|lt)\./.test(bound))) {
    throw new Error("Browser summary requests must have a date bound");
  }
  const matching = filterRecordRows(rows, params);
  const groups = [
    ...new Set(matching.map((row) => JSON.stringify([row.marketplace_name, row.currency]))),
  ].sort();
  return groups.map((key) => {
    const [marketplace, currency] = JSON.parse(key);
    const group = matching.filter(
      (row) => row.marketplace_name === marketplace && row.currency === currency,
    );
    return {
      marketplace_name: marketplace,
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
