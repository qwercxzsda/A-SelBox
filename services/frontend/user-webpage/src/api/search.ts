export function buildSearchFilter(columns: readonly string[], search: string): string | null {
  const term = search.trim();
  if (term === "" || columns.length === 0) return null;
  // A literal regex preserves stars too: PostgREST ilike aliases them to SQL wildcards.
  const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = '"' + pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return "(" + columns.map((column) => column + ".imatch." + quoted).join(",") + ")";
}
