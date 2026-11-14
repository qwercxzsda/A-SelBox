import type { RecordSelection } from "./AmountBreakdown";
import type { PeriodDefinition } from "./summary-periods";
import type { TransactionSummaryScope } from "./api/types";
import { requireDateRange } from "./api/filters.ts";
import { isCurrency, isJsonObject, isUuid } from "./api/validation.ts";
import marketplaces from "./generated/marketplaces.json" with { type: "json" };
import { TOTALS_PERIOD_LABELS } from "./summary-periods.ts";

/** Persist the chosen scope, never a fetched financial result. */
export interface SummaryBreakdownSelection {
  period: PeriodDefinition;
  title: string;
  currency: string;
  scope: TransactionSummaryScope;
}

export function decodeDetailStrings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    value.some(
      (item) => typeof item !== "string" || !item || item.length > 4096 || item.includes("\0"),
    )
  )
    return [];
  return [...new Set(value as string[])];
}

export function decodeDetailPage(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000
    ? value
    : 0;
}

export function decodeDetailOpen(value: unknown): boolean {
  return value === true;
}

export function decodeRecordSelection(value: unknown): RecordSelection {
  const fallback = { label: "All records", types: [] };
  if (!isJsonObject(value) || typeof value.label !== "string" || value.label.length > 4096)
    return fallback;
  const types = decodeDetailStrings(value.types);
  const revision = decodeDetailPage(value.revision);
  return { label: types.length ? value.label : fallback.label, types, revision };
}

export function decodeSummaryBreakdown(value: unknown): SummaryBreakdownSelection | null {
  if (
    !isJsonObject(value) ||
    !isJsonObject(value.period) ||
    !isJsonObject(value.period.range) ||
    !isJsonObject(value.scope) ||
    typeof value.scope.search !== "string" ||
    value.scope.search.length > 4096 ||
    value.scope.search.includes("\0") ||
    typeof value.title !== "string" ||
    !Object.values(TOTALS_PERIOD_LABELS).includes(value.title) ||
    !isCurrency(value.currency) ||
    typeof value.period.label !== "string" ||
    value.period.label.length > 256 ||
    typeof value.period.range.from !== "string" ||
    typeof value.period.range.to !== "string"
  )
    return null;
  const { from, to } = value.period.range;
  if (!from && !to) return null;
  try {
    requireDateRange(from, to);
  } catch {
    return null;
  }
  const scope: TransactionSummaryScope = {
    companyIds: [],
    skus: [],
    marketplaces: [],
    sources: [],
    types: [],
    feeApplicability: [],
    search: value.scope.search,
  };
  for (const field of [
    "companyIds",
    "skus",
    "marketplaces",
    "sources",
    "types",
    "feeApplicability",
  ] as const) {
    const raw = value.scope[field];
    const decoded = decodeDetailStrings(raw);
    if (!Array.isArray(raw) || decoded.length !== raw.length) return null;
    scope[field] = decoded;
  }
  if (
    scope.marketplaces.length !== 1 ||
    scope.companyIds.some((id) => !isUuid(id)) ||
    scope.feeApplicability.some((value) => value !== "applicable" && value !== "not_applicable") ||
    scope.marketplaces.some((name) => !marketplaces.includes(name))
  )
    return null;
  return {
    title: value.title,
    currency: value.currency,
    scope,
    period: { label: value.period.label, range: { from, to } },
  };
}

export function summaryBreakdownKey(value: SummaryBreakdownSelection | null): string {
  return `summary:${JSON.stringify(value && [value.period.range, value.currency, value.scope])}`;
}
