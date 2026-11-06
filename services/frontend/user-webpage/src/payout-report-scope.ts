import type { CanonicalRow } from "./api/types.ts";
import { isMarketplace } from "./api/marketplaces.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { isJsonObject, isUuid, requireCurrency, requireUuid } from "./api/validation.ts";

export interface PayoutReportScope {
  companyId: string;
  startDate: string;
  endDate: string;
  marketplaceName: string | null;
  currency: string | null;
}

export interface PayoutVersionSelection extends PayoutReportScope {
  reportId: string;
}

function isPayoutMarketplace(value: unknown): value is string | null {
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

/** History requests and saved links must identify the same complete report scope. */
export function requirePayoutScope(value: unknown): asserts value is PayoutReportScope {
  if (!isJsonObject(value)) throw new Error("A payout report scope is required");
  requireUuid(value.companyId, "company");
  if (typeof value.startDate !== "string" || typeof value.endDate !== "string")
    throw new Error("A valid date is required");
  requireCalendarDate(value.startDate);
  requireCalendarDate(value.endDate);
  if (value.startDate > value.endDate)
    throw new Error("The start date must be on or before the end date");
  if (value.currency !== null) requireCurrency(value.currency);
  if (!isPayoutMarketplace(value.marketplaceName))
    throw new Error("Choose a valid payout report marketplace");
}

export function payoutVersionSelection(row: CanonicalRow): PayoutVersionSelection {
  return {
    companyId: row.company_id ?? "",
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    currency: row.currency,
    marketplaceName: payoutMarketplace(row),
    reportId: row.id ?? "",
  };
}

export function decodePayoutVersionSelection(value: unknown): PayoutVersionSelection | null {
  if (!isJsonObject(value) || !isUuid(value.reportId)) return null;
  try {
    requirePayoutScope(value);
  } catch {
    return null;
  }
  return {
    companyId: value.companyId,
    startDate: value.startDate,
    endDate: value.endDate,
    currency: value.currency,
    reportId: value.reportId,
    marketplaceName: value.marketplaceName,
  };
}

export function payoutScopeKey(row: CanonicalRow): string {
  return JSON.stringify([
    row.company_id,
    row.start_date,
    row.end_date,
    payoutMarketplace(row),
    row.currency,
  ]);
}
