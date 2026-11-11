export const FEE_STATUSES = ["needs-setup", "draft", "unfinished", "saved"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  "needs-setup": "Needs setup",
  draft: "Draft",
  unfinished: "Unfinished edit",
  saved: "Saved",
};
