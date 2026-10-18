import { ApiError, fetchSessionUser, refreshSession, type Session } from "./api";
import { AuthCallbackError } from "./auth-callback";
import { sessionRefreshDelayMs } from "./session";

/** A restored recovery flow verifies Auth identity without loading company data. */
export async function verifyRecoverySession(
  session: Session,
  save: (session: Session) => Session,
  expectedUserId: string,
): Promise<Session> {
  let current = session;
  let renewed = false;
  if (sessionRefreshDelayMs(current) === 0) {
    current = save(await refreshSession(current.refresh_token));
    renewed = true;
  }
  let user;
  try {
    user = await fetchSessionUser(current.access_token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || renewed) throw error;
    current = save(await refreshSession(current.refresh_token));
    user = await fetchSessionUser(current.access_token);
  }
  if (user.id !== expectedUserId)
    throw new AuthCallbackError(
      "The recovery session changed. Request a new password recovery link.",
      true,
    );
  return save({ ...current, user });
}
