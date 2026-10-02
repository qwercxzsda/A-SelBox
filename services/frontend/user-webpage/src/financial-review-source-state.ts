import type { Identity } from "./auth-session";
import type { ReviewCategory } from "./financial-review-categories";
import { isJsonObject } from "./api/validation.ts";
import { decodeDetailPage } from "./detail-view-state.ts";
import type { FinancialReviewSource } from "./api/financial-review.ts";

export interface ReviewSourceState {
  currency: string;
  source: FinancialReviewSource | "";
  type: string;
  typePage: number;
  recordPage: number;
  recordsOpen: boolean;
}

export function createReviewSourceState(): ReviewSourceState {
  return { currency: "", source: "", type: "", typePage: 0, recordPage: 0, recordsOpen: false };
}

export function decodeReviewSourceState(value: unknown): ReviewSourceState {
  if (!isJsonObject(value)) return createReviewSourceState();
  const source = value.source === "SETTLEMENT" || value.source === "DATA_KIOSK" ? value.source : "";
  return {
    currency:
      typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency) ? value.currency : "",
    source,
    type:
      source &&
      typeof value.type === "string" &&
      value.type.length <= 4096 &&
      !value.type.includes("\0")
        ? value.type
        : "",
    typePage: decodeDetailPage(value.typePage),
    recordPage: decodeDetailPage(value.recordPage),
    recordsOpen: value.recordsOpen === true,
  };
}

export interface FinancialReviewSourceProps {
  identity: Identity;
  category: ReviewCategory;
  month: string;
  matureCutoff: string;
  currency: string;
  state: ReviewSourceState;
  change: (patch: Partial<ReviewSourceState>) => void;
}
