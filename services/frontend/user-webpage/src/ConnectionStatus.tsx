import { useSyncExternalStore } from "react";
import { Alert } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useBrowserOnline } from "./use-browser-online";

/** Connectivity describes cached reads, never the age of the underlying Amazon capture. */
export function ConnectionStatus() {
  const online = useBrowserOnline();
  const cache = useQueryClient().getQueryCache();
  const loadedAt = useSyncExternalStore(
    (notify) => cache.subscribe(notify),
    () => Math.max(0, ...cache.getAll().map((query) => query.state.dataUpdatedAt)),
  );
  if (online) return null;
  return (
    <Alert color="orange" title="Offline" role="status" mb="md">
      {loadedAt
        ? `Showing previously loaded information. Last successful read: ${new Date(loadedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC. `
        : "No information has been loaded in this session. "}
      New views are waiting for a connection. Updates resume automatically when you reconnect.
    </Alert>
  );
}
