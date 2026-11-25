import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { decodeReferenceAssignments } from "../src/api/assignment-codec.ts";
import { DEFAULT_ASSIGNMENT_MEMO } from "../src/api/assignments.ts";
import {
  assignmentContext,
  assignmentStatus,
  decodeAssignmentList,
  filterAssignments,
  newEditorDraft,
  nextUnassigned,
} from "../src/assignments-view.ts";
import { workspaceLocation, locationPreference } from "../src/workspace-location.ts";
import { COMPANY_ID, OTHER_COMPANY_ID, SETTINGS, csvRecord } from "./api-fixtures.mjs";

const KEY_ID = "0198b50b-701a-7000-8000-000000000010";
const VERSION_ID = "0198b50b-701a-7000-8000-000000000011";
const OLDER_VERSION_ID = "0198b50b-701a-7000-8000-000000000012";
const admin = { user_id: "reviewer", access_role: "administrator", company_id: null };
const member = { user_id: "member", access_role: "member", company_id: COMPANY_ID };

/** An administrator item; members receive the same item without the review fields. */
function adminItem(overrides = {}) {
  return {
    kind: "CAMPAIGN",
    seller_namespace: "us-seller",
    amazon_scope: "NA",
    native_key: "campaign-42",
    marketplace_names: ["Amazon.com"],
    company_id: COMPANY_ID,
    key_id: KEY_ID,
    current_version_id: VERSION_ID,
    assignment_origin: "AUTOMATIC",
    warning: null,
    suggested_company_id: COMPANY_ID,
    products: [{ sku: "SKU-1", asin: "B0TESTASIN", company_id: COMPANY_ID }],
    ...overrides,
  };
}

const REVIEW_FIELDS = new Set(["assignment_origin", "warning", "suggested_company_id", "products"]);

function memberItem(overrides = {}) {
  return Object.fromEntries(
    Object.entries(adminItem(overrides)).filter(([field]) => !REVIEW_FIELDS.has(field)),
  );
}

function without(item, field) {
  return Object.fromEntries(Object.entries(item).filter(([name]) => name !== field));
}

function jsonClient(body, requests = []) {
  return createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url: new URL(url), init });
    return Response.json(body);
  });
}

test("the complete list is one POST and decodes administrator and member items", async () => {
  const requests = [];
  const unassigned = adminItem({
    kind: "SHIPMENT",
    native_key: "FBA15ABC",
    marketplace_names: [],
    company_id: null,
    key_id: null,
    current_version_id: null,
    assignment_origin: null,
    warning: "NO_ASSIGNMENT",
    suggested_company_id: null,
    products: [],
  });
  const items = await jsonClient(
    { items: [adminItem(), unassigned] },
    requests,
  ).fetchReferenceAssignments("access", "administrator");
  assert.equal(requests[0].url.pathname, "/rest/v1/rpc/reference_assignments");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.body, "{}");
  assert.deepEqual(items[0], {
    kind: "CAMPAIGN",
    sellerNamespace: "us-seller",
    amazonScope: "NA",
    nativeKey: "campaign-42",
    marketplaceNames: ["Amazon.com"],
    companyId: COMPANY_ID,
    keyId: KEY_ID,
    versionId: VERSION_ID,
    origin: "AUTOMATIC",
    warning: null,
    suggestedCompanyId: COMPANY_ID,
    products: [{ sku: "SKU-1", asin: "B0TESTASIN", companyId: COMPANY_ID }],
  });
  assert.equal(assignmentStatus(items[1]), "needs-setup");
  assert.deepEqual(items[1].marketplaceNames, []);

  const [own] = await jsonClient({ items: [memberItem()] }).fetchReferenceAssignments(
    "access",
    "member",
  );
  assert.deepEqual(
    [own.origin, own.warning, own.suggestedCompanyId, own.products],
    [null, null, null, []],
  );
  assert.equal(assignmentStatus(own), "saved");
});

test("unknown codes, marketplaces and inconsistent items are rejected", async () => {
  const never = {
    company_id: null,
    key_id: null,
    current_version_id: null,
    warning: "NO_ASSIGNMENT",
  };
  for (const [item, message] of [
    [adminItem({ kind: "SKU" }), /Unknown assignment kind/],
    [adminItem({ amazon_scope: "na" }), /Unknown Amazon region na/],
    [adminItem({ warning: "NEW_WARNING" }), /Unknown assignment warning/],
    [adminItem({ assignment_origin: "IMPORTED" }), /Unknown assignment origin/],
    [adminItem({ marketplace_names: ["Amazon.example"] }), /Unknown assignment marketplace/],
    [adminItem({ marketplace_names: ["Amazon.de", "Amazon.de"] }), /marketplace twice/],
    [adminItem({ warning: "NO_ASSIGNMENT" }), /status that does not match/],
    [adminItem({ company_id: null }), /status that does not match/],
    [adminItem({ current_version_id: null }), /key without its current version/],
    [adminItem({ assignment_origin: null }), /origin that does not match its key/],
    [adminItem({ ...never, assignment_origin: "ADMINISTRATOR" }), /origin that does not match/],
    [adminItem({ products: null }), /Invalid product hints/],
    [adminItem({ products: [{ sku: 1, asin: null, company_id: null }] }), /Invalid product hint/],
    [
      adminItem({ products: [{ sku: null, asin: null, company_id: null }] }),
      /Invalid product hint/,
    ],
    // A renamed or dropped field is contract drift, never a null value.
    [without(adminItem(), "key_id"), /missing key_id/],
    [without(adminItem(), "current_version_id"), /missing current_version_id/],
    [without(adminItem(), "company_id"), /missing company_id/],
    [without(adminItem(), "suggested_company_id"), /missing suggested_company_id/],
    // An administrator never receives the member shape.
    [memberItem(), /missing assignment_origin, warning, suggested_company_id, products/],
  ])
    await assert.rejects(
      jsonClient({ items: [item] }).fetchReferenceAssignments("access", "administrator"),
      message,
    );
  for (const [item, message] of [
    [memberItem({ company_id: null }), /no saved company/],
    [memberItem({ key_id: null, current_version_id: null }), /no saved company/],
    [{ ...memberItem(), warning: null }, /included administrator review fields/],
    [adminItem(), /included administrator review fields/],
  ])
    await assert.rejects(
      jsonClient({ items: [item] }).fetchReferenceAssignments("access", "member"),
      message,
    );
  await assert.rejects(
    jsonClient({ items: [adminItem(), adminItem()] }).fetchReferenceAssignments(
      "access",
      "administrator",
    ),
    /an ID twice/,
  );
  await assert.rejects(
    jsonClient([]).fetchReferenceAssignments("access", "administrator"),
    /invalid list/,
  );
});

test("history reads one key's versions newest first and must include the listed version", async () => {
  const version = (id, number, overrides = {}) => ({
    id,
    key_id: KEY_ID,
    version_number: String(number),
    company_id: COMPANY_ID,
    origin: "ADMINISTRATOR",
    memo: "Assign campaign",
    created_at: "2026-09-27 13:20:10+00",
    ...overrides,
  });
  const history = (rows, requests = []) =>
    createApiClient(SETTINGS, async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const columns = parsed.searchParams.get("select").split(",");
      const lines = rows.map((row) =>
        csvRecord(Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))).split(
          "\n",
        ),
      );
      const body = rows.length
        ? [lines[0][0], ...lines.map(([, values]) => values)].join("\n")
        : columns.join(",");
      return new Response(body, {
        headers: {
          "Content-Range": rows.length
            ? `0-${String(rows.length - 1)}/${String(rows.length)}`
            : "*/0",
        },
      });
    }).fetchAssignmentHistory("access", KEY_ID, VERSION_ID);
  const requests = [];
  const versions = await history(
    [version(VERSION_ID, 2), version(OLDER_VERSION_ID, 1, { company_id: null })],
    requests,
  );
  assert.equal(requests[0].pathname, "/rest/v1/assignment_versions");
  assert.equal(requests[0].searchParams.get("key_id"), `eq.${KEY_ID}`);
  assert.equal(requests[0].searchParams.get("order"), "version_number.desc");
  assert.deepEqual(
    versions.map((v) => [v.versionNumber, v.companyId]),
    [
      [2, COMPANY_ID],
      [1, null],
    ],
  );
  await assert.rejects(
    history([version(VERSION_ID, 1), version(OLDER_VERSION_ID, 2)]),
    /invalid version ordering/,
  );
  await assert.rejects(
    history([version(VERSION_ID, 1, { key_id: OTHER_COMPANY_ID })]),
    /different assignment/,
  );
  await assert.rejects(history([version(VERSION_ID, 1, { origin: "IMPORTED" })]), /Unknown/);
  // A concurrent save adds a newer version; the listed one must still be there.
  assert.equal((await history([version(OLDER_VERSION_ID, 2), version(VERSION_ID, 1)])).length, 2);
  await assert.rejects(history([version(OLDER_VERSION_ID, 1)]), /missing the current version/);
  await assert.rejects(history([]), /missing the current version/);
});

test("a blank reason saves the default memo with the expected version", async () => {
  const requests = [];
  const client = jsonClient(VERSION_ID, requests);
  const [row] = decodeReferenceAssignments({ items: [adminItem()] }, "administrator");
  const change = { companyId: COMPANY_ID, memo: "  ", expectedVersionId: OLDER_VERSION_ID };
  assert.equal(await client.setReferenceAssignment("access", row, change), VERSION_ID);
  // The save expects the version editing started from, not the one the list holds now.
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_seller_namespace: "us-seller",
    p_amazon_scope: "NA",
    p_kind: "CAMPAIGN",
    p_native_key: "campaign-42",
    p_company_id: COMPANY_ID,
    p_memo: DEFAULT_ASSIGNMENT_MEMO,
    p_expected_version_id: OLDER_VERSION_ID,
  });
  const release = { companyId: null, memo: " Release ", expectedVersionId: null };
  await client.setReferenceAssignment("access", row, release);
  assert.deepEqual(
    [
      JSON.parse(requests[1].init.body).p_memo,
      JSON.parse(requests[1].init.body).p_expected_version_id,
    ],
    ["Release", null],
  );
  await assert.rejects(
    client.setReferenceAssignment("access", row, { ...release, expectedVersionId: "v1" }),
    /expected version/,
  );
  await assert.rejects(
    jsonClient("not-a-version").setReferenceAssignment("access", row, release),
    /invalid version/,
  );
});

test("an editor draft keeps the version it started from; a draft without one is dropped", () => {
  const [row] = decodeReferenceAssignments({ items: [adminItem()] }, "administrator");
  const draft = newEditorDraft(row);
  assert.equal(draft.expectedVersionId, VERSION_ID);
  const saved = (editor) =>
    decodeAssignmentList({ selected: draft.key, editor: { ...draft, ...editor } }).editor;
  assert.deepEqual(saved({}), draft);
  assert.deepEqual(saved({ expectedVersionId: null }), { ...draft, expectedVersionId: null });
  for (const expectedVersionId of [undefined, "", "v1", 42])
    assert.equal(saved({ expectedVersionId }), null);
});

test("search, filters and the next unassigned ID follow the reference ID order", () => {
  const rows = decodeReferenceAssignments(
    {
      items: [
        adminItem({ native_key: "b-promo", kind: "PROMOTION", marketplace_names: ["Amazon.de"] }),
        adminItem({
          native_key: "a-shipment",
          kind: "SHIPMENT",
          marketplace_names: ["Amazon.com", "Amazon.de"],
          company_id: null,
          warning: "NO_ASSIGNMENT",
        }),
        adminItem({ native_key: "c-campaign", company_id: OTHER_COMPANY_ID }),
      ],
    },
    "administrator",
  );
  const companies = new Map([
    [COMPANY_ID, "North"],
    [OTHER_COMPANY_ID, "South"],
  ]);
  const view = (patch = {}) => ({ ...decodeAssignmentList(null), ...patch });
  const keys = (state, names = companies) =>
    filterAssignments(rows, state, names).map((row) => row.nativeKey);
  assert.deepEqual(keys(view()), ["a-shipment", "b-promo", "c-campaign"]);
  assert.deepEqual(keys(view({ search: "SOUTH" })), ["c-campaign"]);
  assert.deepEqual(keys(view({ search: "south" }), null), []);
  assert.deepEqual(keys(view({ marketplaces: ["Amazon.de"] })), ["a-shipment", "b-promo"]);
  assert.deepEqual(keys(view({ companyIds: [null] })), ["a-shipment"]);
  assert.deepEqual(keys(view({ statuses: ["saved"], kinds: ["CAMPAIGN"] })), ["c-campaign"]);
  assert.equal(nextUnassigned(rows)?.nativeKey, "a-shipment");
  // The drawer context leads with the ID, like every other drawer.
  assert.equal(assignmentContext(rows[0]), "b-promo · Promotion · Amazon.de");
  assert.equal(assignmentContext(rows[1]), "a-shipment · Shipment · 2 marketplaces");
  assert.equal(assignmentContext({ ...rows[2], marketplaceNames: [] }), "c-campaign · Campaign");
});

test("the list state round trips through the URL while the unsaved editor stays local", () => {
  const selected = JSON.stringify(["CAMPAIGN", "us-seller", "NA", 'a,b " ID']);
  const state = {
    ...decodeAssignmentList(null),
    search: "camp",
    kinds: ["CAMPAIGN", "SHIPMENT"],
    companyIds: [null, COMPANY_ID],
    marketplaces: ["Amazon.de"],
    statuses: ["needs-setup"],
    pageIndex: 2,
    pageSize: 50,
    selected,
    editor: {
      key: selected,
      companyId: COMPANY_ID,
      memo: "secret-draft",
      expectedVersionId: VERSION_ID,
    },
  };
  const url = workspaceLocation(
    new URL("https://example.test/"),
    admin,
    new Map([
      ["tab", "assignments"],
      ["assignments:list", state],
    ]),
  );
  assert.equal(url.searchParams.get("row"), selected);
  assert.deepEqual(url.searchParams.getAll("status"), ["needs-setup"]);
  assert.equal(url.href.includes("secret"), false);
  assert.equal(url.href.includes(VERSION_ID), false);
  assert.deepEqual(locationPreference(url, admin, "assignments:list", state), state);
  assert.equal(locationPreference(url, admin, "assignments:list", {}).editor, null);

  // Members have no Company or Status columns, so those filters never reach their links.
  const memberUrl = workspaceLocation(
    new URL("https://example.test/"),
    member,
    new Map([
      ["tab", "assignments"],
      ["assignments:list", state],
    ]),
  );
  assert.equal(memberUrl.searchParams.get("tab"), "assignments");
  assert.deepEqual(memberUrl.searchParams.getAll("company"), []);
  assert.deepEqual(memberUrl.searchParams.getAll("status"), []);
  const restored = locationPreference(url, member, "assignments:list", {});
  assert.deepEqual([restored.companyIds, restored.statuses], [[], []]);
  assert.deepEqual(restored.kinds, ["CAMPAIGN", "SHIPMENT"]);
});

test("saved list state drops unknown codes, marketplaces and company IDs", () => {
  const state = decodeAssignmentList({
    kinds: ["CAMPAIGN", "SKU"],
    statuses: ["saved", "draft"],
    marketplaces: ["Amazon.de", "Amazon.example", "Amazon.de"],
    companyIds: [null, "not-a-uuid", COMPANY_ID],
    pageSize: 7,
    pageIndex: -2,
    selected: "row",
    editor: { key: "other", companyId: COMPANY_ID, memo: "" },
  });
  assert.deepEqual(state.kinds, ["CAMPAIGN"]);
  assert.deepEqual(state.statuses, ["saved"]);
  assert.deepEqual(state.marketplaces, ["Amazon.de"]);
  assert.deepEqual(state.companyIds, [null, COMPANY_ID]);
  assert.deepEqual([state.pageSize, state.pageIndex, state.editor], [25, 0, null]);
});
