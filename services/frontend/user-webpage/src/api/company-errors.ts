import { isJsonObject } from "./validation.ts";

const DELETION_REASON_CODES = [
  "members",
  "assigned_skus",
  "terms_versions",
  "payout_reports",
  "payout_refreshes",
  "other_records",
] as const;

export interface CompanyDeletionReason {
  code: (typeof DELETION_REASON_CODES)[number];
  count: number;
}

export class CompanyDeletionBlockedError extends Error {
  readonly reasons: CompanyDeletionReason[];

  constructor(reasons: CompanyDeletionReason[]) {
    super("Company cannot be deleted while it has linked records.");
    this.name = "CompanyDeletionBlockedError";
    this.reasons = reasons;
  }
}

/** Accept only the deletion RPC's fixed contract, never arbitrary database messages. */
export function companyDeletionRpcError(body: unknown): CompanyDeletionBlockedError | null {
  if (
    !isJsonObject(body) ||
    body.code !== "PT409" ||
    body.message !== "Company cannot be deleted while it has linked records" ||
    typeof body.details !== "string"
  )
    return null;
  try {
    const details: unknown = JSON.parse(body.details);
    if (!Array.isArray(details) || !details.length || details.length > DELETION_REASON_CODES.length)
      return null;
    const reasons: CompanyDeletionReason[] = [];
    for (const entry of details) {
      if (!isJsonObject(entry)) return null;
      const code = DELETION_REASON_CODES.find((value) => value === entry.code);
      if (
        !code ||
        typeof entry.count !== "number" ||
        !Number.isSafeInteger(entry.count) ||
        entry.count <= 0 ||
        reasons.some((reason) => reason.code === code)
      )
        return null;
      reasons.push({ code, count: entry.count });
    }
    return new CompanyDeletionBlockedError(reasons);
  } catch {
    return null;
  }
}
