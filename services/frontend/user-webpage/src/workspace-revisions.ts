import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { AppAccount, DatasetKey, RevisionSource, WorkspaceRevisions } from "./api/types.ts";

export const REVISION_SOURCES: readonly RevisionSource[] = ["settlement", "data_kiosk", "fees"];

export function sameAccount(left: AppAccount, right: AppAccount): boolean {
  return (
    left.user_id === right.user_id &&
    left.access_role === right.access_role &&
    left.company_id === right.company_id
  );
}

function datasetDependencies(dataset: DatasetKey, operator: boolean): readonly RevisionSource[] {
  switch (dataset) {
    case "live":
      return REVISION_SOURCES;
    case "settlement":
      return operator ? ["settlement"] : ["settlement", "fees"];
    case "data_kiosk":
      return operator ? ["data_kiosk"] : ["data_kiosk", "fees"];
    case "fees":
      return ["fees"];
    default:
      return [];
  }
}

export function queryRevisionSources(key: QueryKey): readonly RevisionSource[] {
  const [family] = key;
  if (family === "dataset" || family === "dataset-count") {
    return datasetDependencies(key[4] as DatasetKey, key[2] === "operator");
  }
  if (family === "current-fees") return ["fees"];
  if (
    typeof family === "string" &&
    ["transaction-latest-date", "transaction-period-totals", "transaction-type-totals"].includes(
      family,
    )
  ) {
    return REVISION_SOURCES;
  }
  return [];
}

/** Include active cards and drawers, not just the selected table. */
export function activeRevisionSources(client: QueryClient): RevisionSource[] {
  const active = client.getQueryCache().findAll({ type: "active" });
  const sources = new Set(active.flatMap((query) => queryRevisionSources(query.queryKey)));
  // Lookup labels and SKU ownership are also rendered outside React Query.
  sources.add("fees");
  return REVISION_SOURCES.filter((source) => sources.has(source));
}

export function changedRevisionSources(
  previous: WorkspaceRevisions,
  next: WorkspaceRevisions,
): RevisionSource[] {
  return REVISION_SOURCES.filter(
    (source) => next[source] !== undefined && previous[source] !== next[source],
  );
}

function needsRevisionRefresh(query: Query, changed: readonly RevisionSource[]): boolean {
  return queryRevisionSources(query.queryKey).some((source) => changed.includes(source));
}

/** These small administrative lists do not derive from financial source revisions. */
export function isAdministrativeDataset(dataset: unknown): boolean {
  return dataset === "accounts" || dataset === "payouts";
}

export function isAdministrativeQuery(query: Query): boolean {
  const [family] = query.queryKey;
  const dataset = query.queryKey[4];
  return (family === "dataset" || family === "dataset-count") && isAdministrativeDataset(dataset);
}

/** Financial counts restart after their rows settle; no count delays a page refresh. */
export async function refreshWorkspaceQueries(
  client: QueryClient,
  changed: readonly RevisionSource[],
  force: boolean,
  signal: AbortSignal,
) {
  const predicate = (query: Query) =>
    force || needsRevisionRefresh(query, changed) || isAdministrativeQuery(query);
  signal.throwIfAborted();
  await client.cancelQueries({ predicate });
  signal.throwIfAborted();
  await client.invalidateQueries({ predicate, refetchType: "none" });
  signal.throwIfAborted();
  await client.refetchQueries(
    {
      predicate: (query) => predicate(query) && query.queryKey[0] !== "dataset-count",
      type: "active",
    },
    { throwOnError: true },
  );
}
