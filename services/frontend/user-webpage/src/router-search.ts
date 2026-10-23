type WorkspaceSearch = Record<string, string | string[]>;

export const WORKSPACE_SEARCH_PARAMETERS = {
  tab: "single",
  from: "single",
  to: "single",
  company: "multiple",
  sku: "multiple",
  currency: "single",
  year: "single",
  category: "single",
  month: "single",
  report: "single",
  reportCompany: "single",
  reportFrom: "single",
  reportTo: "single",
  reportCurrency: "single",
  search: "single",
  page: "single",
  size: "single",
  sort: "single",
  order: "single",
  marketplace: "multiple",
  type: "multiple",
  source: "multiple",
  fee: "multiple",
  row: "single",
  health: "multiple",
  recommendation: "multiple",
} as const;

/** Validate URL shapes here; account access and domain values remain in the workspace codecs. */
export function validateWorkspaceSearch(search: Record<string, unknown>): WorkspaceSearch {
  return Object.fromEntries(
    Object.entries(search).flatMap(([key, value]) => {
      const values = (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string",
      );
      if (!values.length) return [];
      const single =
        WORKSPACE_SEARCH_PARAMETERS[key as keyof typeof WORKSPACE_SEARCH_PARAMETERS] === "single";
      return [[key, single || values.length === 1 ? values[0] : values]];
    }),
  );
}

/** Keep existing repeated query keys and literal strings, including JSON-encoded inventory filters. */
export function parseWorkspaceSearch(search: string): WorkspaceSearch {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }),
  );
}

export function stringifyWorkspaceSearch(search: WorkspaceSearch): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
