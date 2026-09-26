import type { ApiTransport } from "./transport.ts";
import { readAllJsonRows } from "./pagination.ts";
import type {
  AppAccount,
  Company,
  SkuAssignment,
  FetchWorkspaceRevisionsOptions,
  WorkspaceRevisionSnapshot,
  WorkspaceRevisions,
} from "./types.ts";
import { isJsonObject, requiredJsonString } from "./validation.ts";

function parseAppAccount(value: Record<string, unknown>, userId: string): AppAccount {
  const user_id = requiredJsonString(value, "user_id");
  const access_role = requiredJsonString(value, "access_role");
  const company_id = value.company_id === null ? null : requiredJsonString(value, "company_id");
  if (
    user_id !== userId ||
    (access_role !== "operator" && access_role !== "company_member") ||
    (access_role === "operator" ? company_id !== null : company_id === null)
  ) {
    throw new Error("Application account query returned an invalid account");
  }
  return { user_id, access_role, company_id };
}

export function createWorkspaceApi(transport: ApiTransport) {
  const { requestJson, authenticatedHeaders } = transport;
  return {
    async fetchWorkspaceRevisions({
      accessToken,
      userId,
      sources,
      signal,
    }: FetchWorkspaceRevisionsOptions): Promise<WorkspaceRevisionSnapshot> {
      if (!userId.trim()) throw new Error("An Auth user ID is required");
      const requested = [...new Set(sources)];
      if (requested.some((source) => !["settlement", "data_kiosk", "fees"].includes(source))) {
        throw new Error("Invalid workspace revision source");
      }
      const params = new URLSearchParams({ p_sources: `{${requested.join(",")}}` });
      const operation = "Workspace access";
      const value = await requestJson(
        `/rest/v1/rpc/workspace_revisions?${params.toString()}`,
        { signal, cache: "no-store", headers: authenticatedHeaders(accessToken) },
        operation,
      );
      if (!isJsonObject(value) || !isJsonObject(value.account) || !isJsonObject(value.revisions)) {
        throw new Error(`${operation} returned invalid revisions`);
      }
      const revisions: WorkspaceRevisions = {};
      for (const source of requested) {
        const revision = requiredJsonString(value.revisions, source);
        if (!revision.trim()) throw new Error(`${operation} returned an empty revision`);
        revisions[source] = revision;
      }
      return { account: parseAppAccount(value.account, userId), revisions };
    },

    async fetchCompanies(accessToken: string): Promise<Company[]> {
      const rows = await readAllJsonRows(
        transport,
        accessToken,
        "companies",
        "id,name",
        "name.asc,id.asc",
        "Company details",
      );
      return rows.map((row) => ({
        id: requiredJsonString(row, "id"),
        name: requiredJsonString(row, "name"),
      }));
    },

    async fetchSkuAssignments(accessToken: string): Promise<SkuAssignment[]> {
      const rows = await readAllJsonRows(
        transport,
        accessToken,
        "company_skus",
        "id,sku,company_id,terms_version_id",
        "id.asc",
        "Product assignments",
      );
      return rows.map((row) => ({
        id: requiredJsonString(row, "id"),
        sku: requiredJsonString(row, "sku"),
        company_id: requiredJsonString(row, "company_id"),
        terms_version_id: requiredJsonString(row, "terms_version_id"),
      }));
    },
  };
}
