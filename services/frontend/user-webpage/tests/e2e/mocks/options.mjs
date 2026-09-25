import { liveRow } from "../api-fixtures.mjs";

export function respondWithOptions(fixture, { request, url, user, reply }) {
  if (request.method() !== "POST" || request.headers().prefer)
    throw new Error("Filter options must use POST without an exact-count request");
  const args = request.postDataJSON();
  const dataset = args.p_dataset;
  fixture.optionRequests.push({ user, dataset, args, endpoint: url.pathname, includeCount: false });
  let rows;
  if (dataset === "live") {
    rows = (
      fixture.liveRows ??
      Array.from({ length: fixture.totalCount }, (_, index) =>
        liveRow(fixture.prefixes[user], index + 1, fixture.companyIds[user]),
      )
    ).filter((row) => row.source !== "DATA_KIOSK" || Number(row.source_amount) !== 0);
  } else if (dataset === "settlement") rows = fixture.settlementRows;
  else if (dataset === "data_kiosk")
    rows = fixture.kioskRows.filter((row) => Number(row.amount) !== 0);
  else if (dataset === "fees") rows = fixture.feeRows;
  else throw new Error(`Unsupported option dataset ${dataset}`);
  const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
  const values = [
    ...new Set(rows.map((row) => row[args.p_field]).filter((value) => typeof value === "string")),
  ]
    .sort(compare)
    .filter((value) => args.p_after === null || compare(value, args.p_after) > 0);
  const page = values.slice(0, Math.min(args.p_limit, fixture.optionPageCap));
  return reply({ values: page, next_cursor: values.length > page.length ? page.at(-1) : null });
}
