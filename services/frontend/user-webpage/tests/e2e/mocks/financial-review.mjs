export const REVIEW_PATHS = new Set([
  "/rest/v1/rpc/financial_review_months",
  "/rest/v1/rpc/financial_outcome_page",
]);

/**
 * Financial review RPCs. `fixture.reviewMonths` holds months RPC rows with a `marketplace_name`
 * (default Amazon.com); `fixture.reviewOutcomes` holds outcome rows. Both filter like the database,
 * and outcome pages apply the limit and offset after the filters.
 */
export async function respondWithFinancialReview(fixture, { url, user, reply, csvReply }) {
  const params = url.searchParams;
  (fixture.reviewRequests ??= []).push({ endpoint: url.pathname, params });
  await fixture.beforeReview?.(url);
  if (fixture.roles[user] !== "administrator") return reply({}, 403);
  if (fixture.reviewStatus && fixture.reviewStatus !== 200) return reply({}, fixture.reviewStatus);
  const marketplace = params.get("p_marketplace");
  const columns = params.get("select").split(",");
  if (url.pathname.endsWith("/financial_review_months")) {
    const rows = (fixture.reviewMonths ?? []).filter(
      (row) =>
        row.month.startsWith(`${params.get("p_year")}-`) &&
        (row.marketplace_name ?? "Amazon.com") === marketplace,
    );
    return csvReply(columns, rows, rows.length, 0, false);
  }
  const month = params.get("p_month").slice(0, 7);
  const rows = (fixture.reviewOutcomes ?? []).filter(
    (row) =>
      row.outcome === params.get("p_outcome") &&
      row.marketplace_name === marketplace &&
      row.posted_date.startsWith(month) &&
      (!params.has("p_reason") || row.reason === params.get("p_reason")) &&
      (!params.has("p_selbox_group") || row.selbox_group === params.get("p_selbox_group")),
  );
  const offset = Number(params.get("p_offset"));
  const page = rows.slice(offset, offset + Number(params.get("p_limit")));
  return csvReply(columns, page, rows.length, offset, false);
}
