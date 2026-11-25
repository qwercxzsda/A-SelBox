export const ASSIGNMENT_PATHS = new Set([
  "/rest/v1/rpc/reference_assignments",
  "/rest/v1/assignment_versions",
  "/rest/v1/rpc/set_reference_assignment",
]);

const REVIEW_FIELDS = new Set(["assignment_origin", "warning", "suggested_company_id", "products"]);

/** Member items carry no review fields: they reveal other companies' SKU ownership. */
function memberItem(item) {
  return Object.fromEntries(Object.entries(item).filter(([field]) => !REVIEW_FIELDS.has(field)));
}

const sameIdentity = (item, args) =>
  item.kind === args.p_kind &&
  item.seller_namespace === args.p_seller_namespace &&
  item.amazon_scope === args.p_amazon_scope &&
  item.native_key === args.p_native_key;

function saveAssignment(fixture, item, args) {
  const count = fixture.assignmentVersions.length + 1;
  const id = `0198b50b-701a-7000-8000-${String(900000000000 + count)}`;
  const keyId = item.key_id ?? `0198b50b-701a-7000-8000-${String(800000000000 + count)}`;
  const previous = fixture.assignmentVersions.filter((version) => version.key_id === keyId);
  fixture.assignmentVersions.push({
    id,
    key_id: keyId,
    version_number: String(previous.length + 1),
    company_id: args.p_company_id,
    origin: "ADMINISTRATOR",
    memo: args.p_memo,
    created_at: `2026-11-${String(10 + count).padStart(2, "0")} 09:30:00+00`,
  });
  Object.assign(item, {
    company_id: args.p_company_id,
    key_id: keyId,
    current_version_id: id,
    assignment_origin: "ADMINISTRATOR",
    warning: args.p_company_id ? null : "NO_ASSIGNMENT",
  });
  for (const source of ["references", "fees"])
    fixture.revisions[source] = String(Number(fixture.revisions[source]) + 1);
  return id;
}

/** `fixture.referenceAssignments` holds administrator items, like rpc/reference_assignments. */
export async function respondWithAssignments(fixture, { request, url, user, reply, csvReply }) {
  const administrator = fixture.roles[user] === "administrator";
  if (url.pathname.endsWith("/reference_assignments")) {
    fixture.referenceAssignmentRequests.push({ user });
    await fixture.beforeReferenceAssignments();
    if (fixture.referenceAssignmentsStatus !== 200)
      return reply({}, fixture.referenceAssignmentsStatus);
    const items = administrator
      ? fixture.referenceAssignments
      : fixture.referenceAssignments
          .filter((item) => item.company_id && item.company_id === fixture.companyIds[user])
          .map(memberItem);
    return reply({ items });
  }
  if (url.pathname.endsWith("/assignment_versions")) {
    const keyId = url.searchParams.get("key_id")?.replace(/^eq\./, "");
    const rows = administrator
      ? fixture.assignmentVersions
          .filter((version) => version.key_id === keyId)
          .sort((left, right) => Number(right.version_number) - Number(left.version_number))
      : [];
    return csvReply(url.searchParams.get("select").split(","), rows);
  }
  const args = request.postDataJSON();
  fixture.assignmentSaves.push(args);
  if (fixture.assignmentSaveStatus) return reply({}, fixture.assignmentSaveStatus);
  if (!administrator) return reply({}, 403);
  const item = fixture.referenceAssignments.find((candidate) => sameIdentity(candidate, args));
  if (!item) return reply({ code: "22023", message: "Unknown assignment key" }, 400);
  if (item.current_version_id !== args.p_expected_version_id)
    return reply({ code: "PT409", message: "Assignment changed while editing" }, 409);
  return reply(saveAssignment(fixture, item, args));
}
