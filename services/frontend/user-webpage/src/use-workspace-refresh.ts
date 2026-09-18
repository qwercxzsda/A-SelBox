import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "./view-model";

/** Check authorization before refreshing any account-scoped data. */
export function useWorkspaceRefresh(checkIdentity: () => Promise<boolean>) {
  const client = useQueryClient();
  const running = useRef(false);
  const lastCheck = useRef(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setIsUpdating(true);
    try {
      if (await checkIdentity()) await client.invalidateQueries();
      setUpdateError(null);
    } catch (error) {
      setUpdateError(`Could not update data: ${getErrorMessage(error)}`);
    } finally {
      lastCheck.current = Date.now();
      running.current = false;
      setIsUpdating(false);
    }
  }, [checkIdentity, client]);

  useEffect(() => {
    if (lastCheck.current === 0) lastCheck.current = Date.now();
    const visibleAndOnline = () => document.visibilityState === "visible" && navigator.onLine;
    const checkIfStale = () => {
      if (visibleAndOnline() && Date.now() - lastCheck.current >= 30_000) void refresh();
    };
    const reconnect = () => {
      if (visibleAndOnline()) void refresh();
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
  }, [refresh]);
  return { refresh, isUpdating, updateError };
}
