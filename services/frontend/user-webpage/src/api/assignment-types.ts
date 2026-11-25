export const ASSIGNMENT_KINDS = ["CAMPAIGN", "PROMOTION", "SHIPMENT"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];
export const ASSIGNMENT_WARNINGS = ["NO_ASSIGNMENT", "PRODUCTS_DISAGREE"] as const;
export type AssignmentWarning = (typeof ASSIGNMENT_WARNINGS)[number];
export const ASSIGNMENT_ORIGINS = ["ADMINISTRATOR", "AUTOMATIC"] as const;
export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export interface AssignmentProduct {
  sku: string | null;
  asin: string | null;
  companyId: string | null;
}

export interface Assignment {
  kind: AssignmentKind;
  sellerNamespace: string;
  amazonScope: string;
  nativeKey: string;
  /** Amazon's own record for campaigns and promotions, the Finances charges for shipments. */
  marketplaceNames: string[];
  companyId: string | null;
  /** Null until the ID is first assigned. */
  keyId: string | null;
  versionId: string | null;
  // Administrator-only review fields. Member items omit them, so they decode as empty.
  origin: AssignmentOrigin | null;
  warning: AssignmentWarning | null;
  suggestedCompanyId: string | null;
  products: AssignmentProduct[];
}

/** Who reads the list decides its shape: members never receive the review fields. */
export type AssignmentReader = "administrator" | "member";

export interface AssignmentVersion {
  id: string;
  versionNumber: number;
  companyId: string | null;
  origin: AssignmentOrigin;
  memo: string;
  createdAt: string;
}

/** Amazon IDs are unique only within their source, seller account, and region. */
export function assignmentKey(
  row: Pick<Assignment, "kind" | "sellerNamespace" | "amazonScope" | "nativeKey">,
): string {
  return JSON.stringify([row.kind, row.sellerNamespace, row.amazonScope, row.nativeKey]);
}
