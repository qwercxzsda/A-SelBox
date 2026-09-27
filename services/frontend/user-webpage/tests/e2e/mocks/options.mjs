import { liveRow } from "../api-fixtures.mjs";

export async function respondWithOptions(fixture, { request, url, user, reply, track }) {
  if (request.method() !== "POST" || request.headers().prefer)
    throw new Error("SKU options must use POST without an exact-count request");
  const args = request.postDataJSON();
  if (Object.keys(args).length !== 0)
    throw new Error("SKU catalog requests must not contain arguments");
  const entry = {
    user,
    args,
    endpoint: url.pathname,
    includeCount: false,
    completed: false,
    failure: null,
  };
  fixture.optionRequests.push(entry);
  track(request, entry);
  if (fixture.roles[user] !== "operator")
    return reply({ code: "42501", message: "Administrator access required" }, 403);
  await fixture.beforeOptions(entry);
  if (fixture.optionStatus !== 200)
    return reply({ message: "SKU catalog unavailable" }, fixture.optionStatus);
  const rows = [
    ...(fixture.liveRows ??
      Array.from({ length: fixture.totalCount }, (_, index) =>
        liveRow(fixture.prefixes[user], index + 1, fixture.companyIds[user]),
      )),
    ...fixture.settlementRows,
    ...fixture.kioskRows,
    ...fixture.assignments,
  ];
  const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
  const values = [
    ...new Set(
      fixture.skuOptions ??
        rows.map(({ sku }) => sku).filter((value) => typeof value === "string" && value.length > 0),
    ),
  ].sort(compare);
  return reply({ values });
}
