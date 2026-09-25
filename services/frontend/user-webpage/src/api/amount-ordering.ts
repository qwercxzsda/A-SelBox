export const MAX_AMOUNT_ORDER_ROWS = 10_000;
export const AMOUNT_ORDER_LIMIT_MESSAGE =
  "Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.";

/** A recoverable query constraint, not an authentication or transport failure. */
export class AmountOrderingLimitError extends Error {
  constructor() {
    super(AMOUNT_ORDER_LIMIT_MESSAGE);
    this.name = "AmountOrderingLimitError";
  }
}
