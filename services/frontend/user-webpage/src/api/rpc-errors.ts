import { MAX_AMOUNT_ORDER_ROWS, AmountOrderingLimitError } from "./amount-ordering.ts";
import { isJsonObject } from "./validation.ts";
import { skuConfigurationRpcError } from "./sku-configuration-errors.ts";
import { companyDeletionRpcError } from "./company-errors.ts";
import { rpcErrorDetails } from "./rpc-error-details.ts";

/** Only allowlisted structured errors produce application-owned interface messages. */
export function publicRpcError(name: string, args: object, body: unknown): Error | null {
  if (name === "publish_sku_configuration") return skuConfigurationRpcError(body);
  if (name === "delete_company") return companyDeletionRpcError(body);
  const error = rpcErrorDetails(body);
  if (
    ["transaction_page", "source_transaction_page"].includes(name) &&
    isJsonObject(args) &&
    args.p_order_by === "amount" &&
    error?.sqlstate === "22023" &&
    error.detail.code === "AMOUNT_ORDER_LIMIT" &&
    error.detail.limit === MAX_AMOUNT_ORDER_ROWS
  )
    return new AmountOrderingLimitError();
  return null;
}
