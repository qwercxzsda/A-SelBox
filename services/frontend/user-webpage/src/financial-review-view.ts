import {
  asReviewReason,
  asSelboxGroup,
  type ReviewReason,
  type SelboxGroup,
} from "./api/financial-review.ts";
import { isJsonObject } from "./api/validation.ts";
import type { ReviewMonth } from "./financial-review-model.ts";
import { isMarketplace } from "./api/marketplaces.ts";

/** Amazon Finances reaches back two years; the earliest retrievable activity is from 2024. */
export const FIRST_REVIEW_YEAR = 2024;
const DEFAULT_REVIEW_MARKETPLACE = "Amazon.com";

export interface FinancialReviewView {
  marketplace: string;
  year: number;
  /** The open month drawer (YYYY-MM within `year`), or "". */
  month: string;
  /** The drawer's selected difference reason and SelBox group. */
  reason: ReviewReason | null;
  selboxGroup: SelboxGroup | null;
}

export type ReviewSelection = Pick<FinancialReviewView, "month" | "reason" | "selboxGroup">;

export const CLOSED_REVIEW_MONTH: ReviewSelection = { month: "", reason: null, selboxGroup: null };

/**
 * The selection a month can show: it keeps the reason and group only where the month has them.
 * Without a month (none open, or one without activity) the drawer closes.
 */
export function selectionFor(
  target: ReviewMonth | undefined,
  { reason, selboxGroup }: ReviewSelection,
): ReviewSelection {
  if (!target) return CLOSED_REVIEW_MONTH;
  return {
    month: target.month,
    reason: target.reasons.some(({ code }) => code === reason) ? reason : null,
    selboxGroup: target.groups.some(({ code }) => code === selboxGroup) ? selboxGroup : null,
  };
}

function currentReviewYear(now = new Date()): number {
  return now.getUTCFullYear();
}

/** Newest first, from the current UTC year back to the first supported year. */
export function reviewYears(now = new Date()): number[] {
  const latest = currentReviewYear(now);
  return Array.from({ length: latest - FIRST_REVIEW_YEAR + 1 }, (_, index) => latest - index);
}

/** Months shown on the chart: the whole year, or January to this month in the current year. */
export function reviewMonthCount(year: number, now = new Date()): number {
  return year < currentReviewYear(now) ? 12 : now.getUTCMonth() + 1;
}

function decodeYear(value: unknown, now: Date): number {
  const year = typeof value === "string" ? Number(value) : value;
  return typeof year === "number" &&
    Number.isSafeInteger(year) &&
    year >= FIRST_REVIEW_YEAR &&
    year <= currentReviewYear(now)
    ? year
    : currentReviewYear(now);
}

/** Saved and linked values outside the constant options fall back to the defaults. */
export function decodeFinancialReviewView(value: unknown, now = new Date()): FinancialReviewView {
  const data = isJsonObject(value) ? value : {};
  const year = decodeYear(data.year, now);
  const month =
    typeof data.month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) &&
    data.month.startsWith(`${String(year)}-`)
      ? data.month
      : "";
  return {
    marketplace: isMarketplace(data.marketplace) ? data.marketplace : DEFAULT_REVIEW_MARKETPLACE,
    year,
    month,
    reason: month ? asReviewReason(data.reason) : null,
    selboxGroup: month ? asSelboxGroup(data.selboxGroup) : null,
  };
}
