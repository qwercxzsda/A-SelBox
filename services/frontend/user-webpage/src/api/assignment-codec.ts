import { regionLabel } from "../amazon-codes.ts";
import { parseRecordTimestamp } from "../date-display.ts";
import {
  ASSIGNMENT_KINDS,
  ASSIGNMENT_ORIGINS,
  ASSIGNMENT_WARNINGS,
  assignmentKey,
  type Assignment,
  type AssignmentProduct,
  type AssignmentReader,
  type AssignmentVersion,
} from "./assignment-types.ts";
import { parseExactCount } from "./content-range.ts";
import { isMarketplace } from "./marketplaces.ts";
import type { CanonicalRow } from "./types.ts";
import { isJsonObject, isUuid, knownCode } from "./validation.ts";

export const LIST_OPERATION = "Assignments";
export const HISTORY_OPERATION = "Assignment history";
const ITEM_FIELDS = [
  "kind",
  "seller_namespace",
  "amazon_scope",
  "native_key",
  "marketplace_names",
  "company_id",
  "key_id",
  "current_version_id",
];
const REVIEW_FIELDS = ["assignment_origin", "warning", "suggested_company_id", "products"];

function assignmentCode<T extends string>(values: readonly T[], value: unknown, label: string) {
  return knownCode(values, value, `assignment ${label}`);
}

function nullableCode<T extends string>(values: readonly T[], value: unknown, label: string) {
  return value === null ? null : assignmentCode(values, value, label);
}

function identityText(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== "string" || !value || value.includes("\0"))
    throw new Error("An assignment is missing its source identity");
  return value;
}

function nullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!isUuid(value)) throw new Error(`A valid ${label} ID is required`);
  return value;
}

/** A renamed or dropped field is contract drift, never an empty value. */
function requireFields(item: Record<string, unknown>, fields: readonly string[]) {
  const missing = fields.filter((field) => !Object.hasOwn(item, field));
  if (missing.length) throw new Error(`An assignment is missing ${missing.join(", ")}`);
}

/** Administrators receive every review field; members receive none of them. */
function requireReviewFields(item: Record<string, unknown>, reader: AssignmentReader) {
  if (reader === "administrator") requireFields(item, REVIEW_FIELDS);
  else if (REVIEW_FIELDS.some((field) => Object.hasOwn(item, field)))
    throw new Error("A member's assignment included administrator review fields");
}

function decodeProduct(value: unknown): AssignmentProduct {
  if (!isJsonObject(value)) throw new Error("Invalid product hint");
  const { sku, asin, company_id } = value;
  if (
    (sku !== null && typeof sku !== "string") ||
    (asin !== null && typeof asin !== "string") ||
    (sku === null && asin === null) ||
    (company_id !== null && !isUuid(company_id))
  )
    throw new Error("Invalid product hint");
  return { sku, asin, companyId: company_id };
}

function decodeMarketplaces(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("An assignment is missing its marketplaces");
  if (new Set(value).size !== value.length)
    throw new Error("An assignment named a marketplace twice");
  return value.map((name: unknown) => {
    if (!isMarketplace(name)) throw new Error(`Unknown assignment marketplace: ${String(name)}`);
    return name;
  });
}

/** The database flags exactly the IDs without a company and keys exactly the assigned ones. */
function decodeReview(
  value: Record<string, unknown>,
  companyId: string | null,
  keyId: string | null,
): Pick<Assignment, "origin" | "warning" | "suggestedCompanyId" | "products"> {
  const origin = nullableCode(ASSIGNMENT_ORIGINS, value.assignment_origin, "origin");
  const warning = nullableCode(ASSIGNMENT_WARNINGS, value.warning, "warning");
  if ((companyId === null) !== (warning === "NO_ASSIGNMENT"))
    throw new Error("An assignment returned a status that does not match its company");
  if ((origin === null) !== (keyId === null))
    throw new Error("An assignment returned an origin that does not match its key");
  if (!Array.isArray(value.products)) throw new Error("Invalid product hints");
  return {
    origin,
    warning,
    suggestedCompanyId: nullableUuid(value.suggested_company_id, "suggested company"),
    products: value.products.map(decodeProduct),
  };
}

/** Assignment details label the region; an unknown region fails the read, not the drawer. */
function knownRegion(code: string): string {
  regionLabel(code);
  return code;
}

function decodeAssignment(value: unknown, reader: AssignmentReader): Assignment {
  if (!isJsonObject(value)) throw new Error("Invalid assignment");
  requireFields(value, ITEM_FIELDS);
  requireReviewFields(value, reader);
  const companyId = nullableUuid(value.company_id, "company");
  const keyId = nullableUuid(value.key_id, "assignment key");
  const versionId = nullableUuid(value.current_version_id, "assignment version");
  if ((keyId === null) !== (versionId === null))
    throw new Error("An assignment returned a key without its current version");
  // Members read only their company's current assignments.
  if (reader === "member" && (companyId === null || keyId === null))
    throw new Error("A member's assignment has no saved company");
  return {
    kind: assignmentCode(ASSIGNMENT_KINDS, value.kind, "kind"),
    sellerNamespace: identityText(value, "seller_namespace"),
    amazonScope: knownRegion(identityText(value, "amazon_scope")),
    nativeKey: identityText(value, "native_key"),
    marketplaceNames: decodeMarketplaces(value.marketplace_names),
    companyId,
    keyId,
    versionId,
    ...(reader === "administrator"
      ? decodeReview(value, companyId, keyId)
      : { origin: null, warning: null, suggestedCompanyId: null, products: [] }),
  };
}

export function decodeReferenceAssignments(value: unknown, reader: AssignmentReader): Assignment[] {
  if (!isJsonObject(value) || !Array.isArray(value.items))
    throw new Error(`${LIST_OPERATION} returned an invalid list`);
  const items = value.items.map((item: unknown) => decodeAssignment(item, reader));
  if (new Set(items.map(assignmentKey)).size !== items.length)
    throw new Error(`${LIST_OPERATION} returned an ID twice`);
  return items;
}

export function decodeVersion(row: CanonicalRow, keyId: string): AssignmentVersion {
  const { id, key_id, version_number, company_id, origin, memo, created_at } = row;
  if (!isUuid(id) || key_id?.toLowerCase() !== keyId.toLowerCase())
    throw new Error(`${HISTORY_OPERATION} returned a different assignment`);
  const versionNumber = parseExactCount(version_number);
  if (
    versionNumber < 1 ||
    !memo?.trim() ||
    !created_at ||
    !parseRecordTimestamp(created_at) ||
    (company_id !== null && !isUuid(company_id))
  )
    throw new Error(`${HISTORY_OPERATION} returned an invalid version`);
  return {
    id,
    versionNumber,
    companyId: company_id,
    origin: assignmentCode(ASSIGNMENT_ORIGINS, origin, "origin"),
    memo,
    createdAt: created_at,
  };
}
