import type { ApiTransport } from "./transport.ts";
import type { Company } from "./types.ts";
import { parseSingleObjectRow, requiredJsonString, requireUuid } from "./validation.ts";
import { parseRecordTimestamp } from "../date-display.ts";

export interface CreateCompanyResult extends Company {
  created: boolean;
}

export interface DeleteCompanyResult {
  id: string;
  deleted: boolean;
}

/** One saved company from the catalog; its creation time is a timestamp with an offset. */
export function parseCompanyRow(row: Record<string, unknown>): Company {
  const createdAt = requiredJsonString(row, "created_at");
  if (!parseRecordTimestamp(createdAt)) throw new Error("JSON response has invalid created_at");
  return {
    id: requiredJsonString(row, "id"),
    name: requiredJsonString(row, "name"),
    created_at: createdAt,
  };
}

export function createCompanyApi({ postRpc }: ApiTransport) {
  return {
    async deleteCompany(accessToken: string, companyId: string): Promise<DeleteCompanyResult> {
      requireUuid(companyId, "company");
      const operation = "Delete company";
      const row = parseSingleObjectRow(
        await postRpc(accessToken, "delete_company", { target_company_id: companyId }, operation),
        operation,
      );
      const id = requiredJsonString(row, "id");
      requireUuid(id, "company");
      if (id.toLowerCase() !== companyId.toLowerCase() || typeof row.deleted !== "boolean")
        throw new Error("Company deletion returned an invalid result");
      return { id, deleted: row.deleted };
    },
    async createCompany(accessToken: string, name: string): Promise<CreateCompanyResult> {
      const trimmed = typeof name === "string" ? name.trim() : "";
      // Match PostgreSQL char_length, including non-BMP characters.
      if (!trimmed || Array.from(trimmed).length > 200 || trimmed.includes("\0"))
        throw new Error("Enter a company name of 1 to 200 characters.");
      const operation = "Add company";
      const row = parseSingleObjectRow(
        await postRpc(accessToken, "create_company", { company_name: trimmed }, operation),
        operation,
      );
      const id = requiredJsonString(row, "id");
      const companyName = requiredJsonString(row, "name");
      requireUuid(id, "company");
      if (!companyName.trim() || companyName.includes("\0") || typeof row.created !== "boolean")
        throw new Error("Company creation returned an invalid company");
      // The write acknowledgment excludes metadata; the catalog supplies the saved timestamp.
      return { id, name: companyName, created_at: null, created: row.created };
    },
  };
}
