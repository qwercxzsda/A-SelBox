export async function respondWithPayoutReadiness(fixture, { url, user, reply, csvReply }) {
  const params = url.searchParams;
  const blockers = url.pathname.endsWith("payout_setup_blockers");
  const request = { user, endpoint: url.pathname, params };
  (fixture.payoutReadinessRequests ??= []).push(request);
  if (fixture.roles[user] === "unassigned" || (blockers && fixture.roles[user] !== "administrator"))
    return reply({}, 403);
  if (fixture.payoutReadinessStatus && fixture.payoutReadinessStatus !== 200)
    return reply({}, fixture.payoutReadinessStatus);
  const month = params.get("p_month");
  const companyIds = params.get("p_company_ids")?.slice(1, -1).split(",") ?? [];
  const rows = blockers
    ? (fixture.payoutSetupBlockers ?? []).filter(
        (row) => row.company_id === params.get("p_company_id") && row.month === month,
      )
    : (fixture.payoutReadinessRows ?? []).filter(
        (row) =>
          row.month === month &&
          (fixture.roles[user] === "administrator" ||
            row.company_id === fixture.companyIds[user]) &&
          (!companyIds.length || companyIds.includes(row.company_id)),
      );
  const offset = Number(params.get("p_offset") ?? 0);
  const limit = Number(params.get("p_limit") ?? 26);
  return csvReply(
    params.get("select").split(","),
    rows.slice(offset, offset + limit),
    rows.length,
    offset,
    false,
  );
}
