import { MAX_AMOUNT_ORDER_ROWS } from "../../../src/api/amount-ordering.ts";

export function amountOrderLimitExceeded(fixture, entry, actualCount) {
  return (
    entry.args.p_order_by === "amount" &&
    (fixture.amountOrderCountForRequest?.(entry) ?? actualCount) > MAX_AMOUNT_ORDER_ROWS
  );
}

export const AMOUNT_ORDER_LIMIT_RESPONSE = {
  code: "22023",
  message: "Private amount limit diagnostic",
  details: JSON.stringify({ code: "AMOUNT_ORDER_LIMIT", limit: MAX_AMOUNT_ORDER_ROWS }),
};
