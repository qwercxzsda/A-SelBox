import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, fetchWorkspaceRevisions } from "./api";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";
import {
  activeRevisionSources,
  changedRevisionSources,
  isAdministrativeQuery,
  refreshWorkspaceQueries,
  sameAccount,
} from "./workspace-revisions";

interface PendingCheck {
  controller: AbortController;
  task: Promise<void>;
}

/** Poll tiny revision tokens; financial reads run only when their dependencies change. */
export function useWorkspaceRefresh(identity: Identity, checkIdentity: () => Promise<boolean>) {
  const client = useQueryClient();
  const baseline = useRef(identity.revisions);
  const pending = useRef<PendingCheck | null>(null);
  const mounted = useRef(false);
  const forceRequested = useRef(false);
  const lastCheck = useRef(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const check = useCallback(
    (force = false): Promise<void> => {
      forceRequested.current ||= force;
      if (pending.current) return pending.current.task;
      const controller = new AbortController();
      // Re-read after awaited work: a Retry click can change this ref mid-check.
      const retryRequested = () => forceRequested.current;
      const current = () =>
        pending.current?.controller === controller && !controller.signal.aborted;
      const task = Promise.resolve().then(async () => {
        try {
          const snapshot = await fetchWorkspaceRevisions({
            accessToken: identity.session.access_token,
            userId: identity.session.user.id,
            sources: activeRevisionSources(client),
            signal: controller.signal,
          });
          if (!current()) return;
          if (!sameAccount(snapshot.account, identity.account)) {
            await checkIdentity();
            return;
          }
          const changed = changedRevisionSources(baseline.current, snapshot.revisions);
          const administrative =
            client.getQueryCache().findAll({ type: "active", predicate: isAdministrativeQuery })
              .length > 0;
          do {
            const forced = forceRequested.current;
            forceRequested.current = false;
            if (changed.length > 0 || forced || administrative) {
              setIsUpdating(true);
              if ((forced || changed.includes("fees")) && !(await checkIdentity())) return;
              if (!current()) return;
              await refreshWorkspaceQueries(client, changed, forced, controller.signal);
            }
            // A Retry click during a selective refetch must not be swallowed.
          } while (current() && retryRequested());
          if (!current()) return;
          baseline.current = { ...baseline.current, ...snapshot.revisions };
          setUpdateError(null);
        } catch (error) {
          if (!current()) return;
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            // Reuse token renewal/access-removal handling; never trust cached permissions.
            try {
              await checkIdentity();
            } catch (identityError) {
              if (current())
                setUpdateError(`Could not check for updates: ${getErrorMessage(identityError)}`);
            }
          } else {
            setUpdateError(`Could not check for updates: ${getErrorMessage(error)}`);
          }
        } finally {
          if (current()) {
            lastCheck.current = Date.now();
            pending.current = null;
            setIsUpdating(false);
          } else if (mounted.current && pending.current === null) {
            setIsUpdating(false);
          }
        }
      });
      pending.current = { controller, task };
      return task;
    },
    [identity, checkIdentity, client],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.controller.abort();
      pending.current = null;
    };
  }, [identity.session.access_token]);

  useEffect(() => {
    if (lastCheck.current === 0) lastCheck.current = Date.now();
    const visibleAndOnline = () => document.visibilityState === "visible" && navigator.onLine;
    const checkIfStale = () => {
      if (visibleAndOnline() && Date.now() - lastCheck.current >= 30_000) void check();
    };
    const reconnect = () => {
      if (visibleAndOnline()) void check();
    };
    const timer = window.setInterval(checkIfStale, 60_000);
    window.addEventListener("focus", checkIfStale);
    document.addEventListener("visibilitychange", checkIfStale);
    window.addEventListener("online", reconnect);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkIfStale);
      document.removeEventListener("visibilitychange", checkIfStale);
      window.removeEventListener("online", reconnect);
    };
  }, [check]);

  const refresh = () => check(true);
  return { refresh, isUpdating, updateError };
}
