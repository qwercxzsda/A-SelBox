import {
  AMOUNT_ORDER_LIMIT_MESSAGE,
  MAX_AMOUNT_ORDER_ROWS,
} from "../../../src/api/amount-ordering.ts";

export function amountOrderLimitExceeded(fixture, entry, actualCount) {
  return (
    entry.args.p_order_by === "amount" &&
    (fixture.amountOrderCountForRequest?.(entry) ?? actualCount) > MAX_AMOUNT_ORDER_ROWS
  );
}

export const AMOUNT_ORDER_LIMIT_RESPONSE = { code: "22023", message: AMOUNT_ORDER_LIMIT_MESSAGE };
