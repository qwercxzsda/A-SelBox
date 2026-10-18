import { fetchSessionUser, type Session } from "./api";
import {
  loadIdentity,
  restoreIdentity,
  type Identity,
  type browserSessionStore,
} from "./auth-session";
import type { createAuthCallbackStore } from "./auth-callback-storage";
import { verifyRecoverySession } from "./auth-recovery";
import { AuthCallbackError } from "./auth-callback";
import { clearBrowserWorkspace } from "./workspace-browser-storage";

type RestoredAuthentication =
  | { kind: "recovery"; session: Session }
  | { kind: "workspace"; identity: Identity | null };

/** Restore one flow; recovery sessions must never load an authenticated workspace. */
export async function restoreAuthentication(
  sessions: ReturnType<typeof browserSessionStore>,
  callbacks: ReturnType<typeof createAuthCallbackStore>,
  save: (session: Session) => Session,
): Promise<RestoredAuthentication> {
  const flow = callbacks.read();
  if (flow.pending) {
    const { kind, tokens } = flow.pending;
    clearBrowserWorkspace();
    sessions.clear();
    const user = await fetchSessionUser(tokens.access_token);
    const session = save({ ...tokens, user });
    if (kind === "recovery") {
      callbacks.write({ pending: null, recovery: { stage: "password", userId: user.id } });
      return { kind: "recovery", session };
    }
    callbacks.clear();
    return { kind: "workspace", identity: await loadIdentity(session) };
  }

  const session = sessions.read();
  if (flow.recovery?.stage === "password") {
    if (!session) throw new AuthCallbackError("Request a new recovery link to continue.", true);
    return {
      kind: "recovery",
      session: await verifyRecoverySession(session, save, flow.recovery.userId),
    };
  }
  if (!session) clearBrowserWorkspace();
  return {
    kind: "workspace",
    identity: session ? await restoreIdentity(session, save) : null,
  };
}
