import { expect } from "@playwright/test";

export const PRODUCT_COMPANY = "0198b50b-701a-7000-8000-000000000041";
export const OTHER_COMPANY = "0198b50b-701a-7000-8000-000000000043";
const KEY = "0198b50b-701a-7000-8000-000000000050";
const VERSION = "0198b50b-701a-7000-8000-000000000051";

/** An administrator item of rpc/reference_assignments; assigned unless overridden. */
export function referenceAssignment(nativeKey, overrides = {}) {
  const item = {
    kind: "CAMPAIGN",
    seller_namespace: "us-seller",
    amazon_scope: "NA",
    native_key: nativeKey,
    marketplace_names: ["Amazon.com"],
    company_id: PRODUCT_COMPANY,
    key_id: KEY,
    current_version_id: VERSION,
    assignment_origin: "AUTOMATIC",
    warning: null,
    suggested_company_id: PRODUCT_COMPANY,
    products: [{ sku: "ALPHA-1", asin: "B0TESTASIN", company_id: PRODUCT_COMPANY }],
    ...overrides,
  };
  return item;
}

/** An ID no company bears yet; it has never been assigned. */
export function unassignedReference(nativeKey, overrides = {}) {
  return referenceAssignment(nativeKey, {
    company_id: null,
    key_id: null,
    current_version_id: null,
    assignment_origin: null,
    warning: "NO_ASSIGNMENT",
    ...overrides,
  });
}

/** The saved version behind `referenceAssignment`'s default key. */
export function automaticVersion(overrides = {}) {
  return {
    id: VERSION,
    key_id: KEY,
    version_number: "1",
    company_id: PRODUCT_COMPANY,
    origin: "AUTOMATIC",
    memo: "Automatically assigned from product ownership",
    created_at: "2026-11-01 02:00:00+00",
    ...overrides,
  };
}

export function setupAssignments(fixture, role, items, versions = []) {
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = PRODUCT_COMPANY;
  fixture.companyNames[PRODUCT_COMPANY] = "Product company";
  fixture.companyNames[OTHER_COMPANY] = "Other company";
  fixture.referenceAssignments = items;
  fixture.assignmentVersions = versions;
}

export const assignmentTable = (page) =>
  page.getByRole("table", { name: "Assignments", exact: true });
export const assignmentRow = (page, nativeKey) =>
  assignmentTable(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader", { name: nativeKey, exact: true }),
    });
export const assignmentDrawer = (page) =>
  page.getByRole("dialog", { name: "Assignment details", exact: true });
export const assignmentEditor = (page) =>
  page.getByRole("dialog", { name: "Assignment editor", exact: true });

export async function openAssignments(page) {
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assignments", level: 2 })).toBeVisible();
}
