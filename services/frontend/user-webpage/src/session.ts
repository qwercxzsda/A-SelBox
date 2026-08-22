import type { Session } from "./api/types";

const REFRESH_MARGIN_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function sessionRefreshDelayMs(session: Session, nowMs = Date.now()): number {
  const expiresAtMs =
    session.expires_at === undefined
      ? nowMs + session.expires_in * 1_000
      : session.expires_at * 1_000;
  const desiredDelay = expiresAtMs - nowMs - REFRESH_MARGIN_MS;
  return Math.max(0, Math.min(MAX_TIMER_DELAY_MS, desiredDelay));
}
