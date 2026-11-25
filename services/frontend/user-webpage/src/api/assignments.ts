import {
  decodeReferenceAssignments,
  decodeVersion,
  HISTORY_OPERATION,
  LIST_OPERATION,
} from "./assignment-codec.ts";
import type { Assignment, AssignmentReader, AssignmentVersion } from "./assignment-types.ts";
import { readAllCsvRows } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import { isUuid, requireUuid } from "./validation.ts";

/** Saved when an administrator leaves the reason blank; the database requires one. */
export const DEFAULT_ASSIGNMENT_MEMO = "Administrator updated assignment";

/** The ID a save names. */
type AssignmentIdentity = Pick<
  Assignment,
  "sellerNamespace" | "amazonScope" | "kind" | "nativeKey"
>;

/** The saved company, the reason, and the version the change started from. */
export interface AssignmentChange {
  companyId: string | null;
  memo: string;
  expectedVersionId: string | null;
}

export function createAssignmentApi(transport: ApiTransport) {
  return {
    /** The complete list in one JSON value: every known ID for administrators, own IDs for members. */
    async fetchReferenceAssignments(
      accessToken: string,
      reader: AssignmentReader,
      signal?: AbortSignal,
    ): Promise<Assignment[]> {
      return decodeReferenceAssignments(
        await transport.postRpc(accessToken, "reference_assignments", {}, LIST_OPERATION, signal),
        reader,
      );
    },
    /** Every saved version of one assigned ID, newest first; it includes the listed version. */
    async fetchAssignmentHistory(
      accessToken: string,
      keyId: string,
      versionId: string,
      signal?: AbortSignal,
    ): Promise<AssignmentVersion[]> {
      requireUuid(keyId, "assignment key");
      requireUuid(versionId, "assignment version");
      const versions = await readAllCsvRows(transport, {
        accessToken,
        endpoint: "assignment_versions",
        columns: ["id", "key_id", "version_number", "company_id", "origin", "memo", "created_at"],
        order: "version_number.desc",
        operation: HISTORY_OPERATION,
        decode: (row) => decodeVersion(row, keyId),
        identity: (version) => version.id,
        signal,
        filters: { key_id: `eq.${keyId}` },
      });
      if (versions.some((v, i) => i > 0 && v.versionNumber >= versions[i - 1].versionNumber))
        throw new Error(`${HISTORY_OPERATION} returned invalid version ordering`);
      // A newer version may follow a concurrent save; the listed one must still be there.
      if (!versions.some((version) => version.id.toLowerCase() === versionId.toLowerCase()))
        throw new Error(`${HISTORY_OPERATION} is missing the current version`);
      return versions;
    },
    /** Saves a company for one ID; the database refuses it (409) if `expectedVersionId` is stale. */
    async setReferenceAssignment(
      accessToken: string,
      assignment: AssignmentIdentity,
      { companyId, memo, expectedVersionId }: AssignmentChange,
    ): Promise<string> {
      if (companyId !== null) requireUuid(companyId, "company");
      if (expectedVersionId !== null) requireUuid(expectedVersionId, "expected version");
      const versionId = await transport.postRpc(
        accessToken,
        "set_reference_assignment",
        {
          p_seller_namespace: assignment.sellerNamespace,
          p_amazon_scope: assignment.amazonScope,
          p_kind: assignment.kind,
          p_native_key: assignment.nativeKey,
          p_company_id: companyId,
          p_memo: memo.trim() || DEFAULT_ASSIGNMENT_MEMO,
          p_expected_version_id: expectedVersionId,
        },
        "Save assignment",
      );
      if (!isUuid(versionId)) throw new Error("Save assignment returned an invalid version");
      return versionId;
    },
  };
}
