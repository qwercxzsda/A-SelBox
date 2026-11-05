import type { CanonicalRow } from "./api/types.ts";
import { isMarketplace } from "./api/marketplaces.ts";

export function isPayoutMarketplace(value: unknown): value is string | null {
  return value === null || isMarketplace(value);
}

/** Null identifies a genuinely unspecified marketplace; missing metadata is invalid. */
export function payoutMarketplace(row: CanonicalRow): string | null {
  const marketplace = row.marketplace_name;
  if (!isPayoutMarketplace(marketplace))
    throw new Error("Payout report returned a missing or invalid marketplace");
  return marketplace;
}

export function payoutMarketplaceLabel(row: CanonicalRow): string {
  return payoutMarketplace(row) ?? "Not specified";
}
