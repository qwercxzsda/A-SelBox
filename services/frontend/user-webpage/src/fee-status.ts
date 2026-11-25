import type { StatusTone } from "./StatusBadge";

export const FEE_STATUSES = ["needs-setup", "draft", "unfinished", "saved"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  "needs-setup": "Needs setup",
  draft: "Draft",
  unfinished: "Unfinished edit",
  saved: "Saved",
};

export const FEE_STATUS_TONES: Record<FeeStatus, StatusTone> = {
  saved: "success",
  draft: "info",
  unfinished: "neutral",
  "needs-setup": "warning",
};
