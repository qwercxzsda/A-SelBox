import { csv } from "../api-fixtures.mjs";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range",
};

export function createReplies(route) {
  return {
    reply: (json, status = 200, headers = {}) =>
      route.fulfill({
        status,
        headers: { ...CORS_HEADERS, ...headers },
        contentType: "application/json",
        body: JSON.stringify(json),
      }),
    csvReply: (columns, rows, total = rows.length, offset = 0, includeCount = true) =>
      route.fulfill({
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Range": contentRange(rows.length, total, offset, includeCount),
        },
        contentType: "text/csv",
        body: csv(columns, rows),
      }),
  };
}

export function contentRange(length, total, offset = 0, includeCount = true) {
  return `${length ? `${offset}-${offset + length - 1}` : "*"}/${includeCount ? total : "*"}`;
}

export function trackRequests(page) {
  const entries = new WeakMap();
  page.on("requestfinished", (request) => {
    const entry = entries.get(request);
    if (entry) entry.completed = true;
  });
  page.on("requestfailed", (request) => {
    const entry = entries.get(request);
    if (entry) entry.failure = request.failure()?.errorText ?? "Unknown request failure";
  });
  return (request, entry) => entries.set(request, entry);
}
