const ROUTE_KEYS = [
  "tab",
  "from",
  "to",
  "company",
  "sku",
  "currency",
  "year",
  "category",
  "month",
  "report",
  "reportCompany",
  "reportFrom",
  "reportTo",
  "reportCurrency",
  "search",
  "page",
  "size",
  "sort",
  "order",
  "marketplace",
  "type",
  "source",
  "fee",
  "row",
  "health",
  "recommendation",
];

export function withoutWorkspaceLocation(url: URL): URL {
  const next = new URL(url);
  for (const key of ROUTE_KEYS) next.searchParams.delete(key);
  return next;
}

export function clearWorkspaceLocation() {
  window.history.replaceState(null, "", withoutWorkspaceLocation(new URL(window.location.href)));
}
