/** Explicit catalog matches for transport tests; UI matching is tested separately. */
export function searchValues(overrides = {}) {
  return { skus: [], types: [], marketplaces: [], sources: [], ...overrides };
}
