import { AMOUNT_ORDER_LIMIT_MESSAGE, AmountOrderingLimitError } from "./amount-ordering.ts";
import { isJsonObject } from "./validation.ts";
import { skuConfigurationRpcError } from "./sku-configuration-errors.ts";

/** Only allowlisted public errors may expose database messages to the interface. */
export function publicRpcError(name: string, args: object, body: unknown): Error | null {
  if (!isJsonObject(body)) return null;
  if (name === "publish_sku_configuration") return skuConfigurationRpcError(body);
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
