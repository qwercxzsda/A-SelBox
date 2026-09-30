import type { Identity } from "./auth-session.ts";
import type { Session, WorkspaceRevisionSnapshot } from "./api/types.ts";
import { FINANCIAL_REVISION_SOURCES, sameAccount } from "./workspace-revisions.ts";

/** Only a freshly verified, unchanged administrator scope can reuse this in-memory catalog. */
export function reusableAdminSkuOptions(
  previous: Identity | null | undefined,
  session: Session,
  snapshot: WorkspaceRevisionSnapshot,
  forceCatalog = false,
): string[] | null {
  if (
    forceCatalog ||
    !previous ||
    snapshot.account.access_role !== "operator" ||
    snapshot.account.user_id !== session.user.id ||
    previous.session.user.id !== session.user.id ||
    !sameAccount(previous.account, snapshot.account) ||
    !FINANCIAL_REVISION_SOURCES.every((source) => {
      const revision = previous.revisions[source];
      return (
        typeof revision === "string" &&
        revision.trim() !== "" &&
        revision === snapshot.revisions[source]
      );
    })
  )
    return null;
  return previous.skuOptions;
}
