import { AMOUNT_ORDER_LIMIT_MESSAGE, AmountOrderingLimitError } from "./amount-ordering.ts";
import { isJsonObject } from "./validation.ts";

const PAYOUT_ERRORS: Readonly<Record<string, string>> = {
  "Unresolved ownership or fee coverage prevents a complete payout report":
    "Required SKU ownership or service fee rates are missing for this month.",
  "The selected month is not yet eligible for a payout report":
    "This month includes recent dates and cannot be used for a payout report.",
  "Incomplete, pruned or incompatible payout Data Kiosk coverage":
    "Complete, compatible Data Kiosk coverage is required for this month’s Data Kiosk category amounts.",
  "Source preprocessing versions must agree for a monthly payout":
    "Settlement and Data Kiosk inputs must use the same processing version for this month.",
};

/** Only allowlisted public errors may expose database messages to the interface. */
export function publicRpcError(name: string, args: object, body: unknown): Error | null {
  if (!isJsonObject(body)) return null;
  if (
    name === "generate_company_payout_reports" &&
    ["22023", "23514"].includes(String(body.code)) &&
    typeof body.message === "string" &&
    Object.hasOwn(PAYOUT_ERRORS, body.message)
  )
    return new Error(PAYOUT_ERRORS[body.message]);
  if (
    ["transaction_page", "source_transaction_page"].includes(name) &&
    isJsonObject(args) &&
    args.p_order_by === "amount" &&
    body.code === "22023" &&
    body.message === AMOUNT_ORDER_LIMIT_MESSAGE
  )
    return new AmountOrderingLimitError();
  return null;
}
