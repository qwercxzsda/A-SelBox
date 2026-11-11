import type { PayoutReadinessFacts } from "./api/payout-readiness.ts";

function readinessStatus(facts: PayoutReadinessFacts) {
  if (!facts.mature) return "IMMATURE";
  if (facts.refresh_pending) {
    if (facts.failure_count > 0) return "BLOCKED";
    return facts.has_report ? "UPDATING" : "PENDING";
  }
  if (facts.has_report) return facts.has_activity ? "COMPLETE" : "NO_ACTIVITY";
  return facts.eligible ? "PENDING" : "NOT_SCHEDULED";
}

/** Readiness precedence and explanation are presentation choices over operational facts. */
export function payoutReadinessState(facts: PayoutReadinessFacts) {
  const status = readinessStatus(facts);
  return {
    status,
    reason:
      status === "BLOCKED"
        ? facts.failure_reason
        : status === "NOT_SCHEDULED"
          ? "NO_ASSIGNED_SKUS"
          : null,
    nextAttemptAt: facts.refresh_pending && facts.mature ? facts.next_attempt_at : null,
  };
}
