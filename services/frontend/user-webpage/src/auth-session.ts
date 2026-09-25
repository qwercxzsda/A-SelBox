import {
  ApiError,
  fetchAppAccount,
  fetchCompanies,
  fetchSessionUser,
  fetchSkuAssignments,
  fetchWorkspaceRevisions,
  refreshSession,
  type AppAccount,
  type Company,
  type Session,
  type SkuAssignment,
  type WorkspaceRevisions,
} from "./api";
import { readBuildConfig } from "./api/runtime-config";
import { validateApiConfig } from "./api/client-config";
import { sessionRefreshDelayMs } from "./session";
import { createSessionStore, sessionStorageKey } from "./session-storage";
import { REVISION_SOURCES } from "./workspace-revisions";

export interface Identity {
  session: Session;
  account: AppAccount;
  companies: Company[];
  assignments: SkuAssignment[];
  revisions: WorkspaceRevisions;
}

export function browserSessionStore() {
  try {
    const { supabaseUrl } = validateApiConfig(readBuildConfig());
    return createSessionStore(window.sessionStorage, sessionStorageKey(supabaseUrl));
  } catch {
    return createSessionStore(null, "");
  }
}

export function isTemporaryAuthError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === null || error.status >= 500 || error.status === 429)
  );
}

export async function loadIdentity(session: Session): Promise<Identity> {
  // Capture the baseline before loading any dependent lookups or financial data.
  // A publication during those reads will then be detected by the next poll.
  const { revisions } = await fetchWorkspaceRevisions({
    accessToken: session.access_token,
    userId: session.user.id,
    sources: REVISION_SOURCES,
  });
  const [account, companies, assignments] = await Promise.all([
    fetchAppAccount(session.access_token, session.user.id),
    fetchCompanies(session.access_token),
    fetchSkuAssignments(session.access_token),
  ]);
  return { session, account, companies, assignments, revisions };
}

type SaveSession = (session: Session) => Session;

/** Save token rotation before any subsequent request can fail or the page reloads. */
export async function renewIdentity(session: Session, save: SaveSession): Promise<Identity> {
  const renewed = save(await refreshSession(session.refresh_token));
  return loadIdentity(renewed);
}

export async function restoreIdentity(session: Session, save: SaveSession): Promise<Identity> {
  if (sessionRefreshDelayMs(session) === 0) return renewIdentity(session, save);
  try {
    const user = await fetchSessionUser(session.access_token);
    return await loadIdentity(save({ ...session, user }));
  } catch (error) {
    // A token may expire while the page is suspended or the local clock is skewed.
    if (error instanceof ApiError && error.status === 401) return renewIdentity(session, save);
    throw error;
  }
}
