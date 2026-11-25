import { useQuery } from "@tanstack/react-query";
import { fetchAssignmentHistory } from "./api";
import type { AssignmentVersion } from "./api/assignment-types";
import type { Identity } from "./auth-session";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { ErrorAlert } from "./ErrorAlert";
import { LoadingStatus } from "./LoadingStatus";
import { loadErrorDetail } from "./load-error";
import { companyLabel } from "./view-model";

const ORIGIN_LABELS: Record<AssignmentVersion["origin"], string> = {
  ADMINISTRATOR: "Administrator",
  AUTOMATIC: "Automatic",
};

/** Every saved version of one assigned ID, newest first (administrators only). */
export function AssignmentHistory({
  identity,
  keyId,
  versionId,
  companies,
}: {
  identity: Identity;
  keyId: string;
  /** The listed current version; the history must include it. */
  versionId: string;
  companies: Map<string, string>;
}) {
  const query = useQuery({
    // The current version is part of the key so a save shows its new version.
    queryKey: ["assignments", identity.session.user.id, "history", keyId, versionId],
    queryFn: ({ signal }) =>
      fetchAssignmentHistory(identity.session.access_token, keyId, versionId, signal),
  });
  return (
    <DetailSection
      title="Assignment history"
      actions={
        <LoadingStatus state={query.isPending ? "loading" : query.isFetching ? "updating" : null} />
      }
    >
      {query.isError ? (
        <ErrorAlert
          title="Could not load assignment history"
          detail={loadErrorDetail(query.error)}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data ? (
        <DetailTable
          label="Assignment history"
          // Phones scroll the table sideways rather than splitting every word.
          minWidth={640}
          columns={[
            { key: "version", label: "Version", nowrap: true },
            { key: "saved", label: "Saved (UTC)", kind: "date", nowrap: true },
            { key: "company", label: "Company" },
            { key: "origin", label: "Set by" },
            { key: "reason", label: "Reason" },
          ]}
          rows={query.data.map((version) => ({
            id: version.id,
            version: String(version.versionNumber),
            saved: version.createdAt,
            company: companyLabel(version.companyId, companies),
            origin: ORIGIN_LABELS[version.origin],
            reason: version.memo,
          }))}
          rowKey={(row) => row.id ?? ""}
        />
      ) : null}
    </DetailSection>
  );
}
