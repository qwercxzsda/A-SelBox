import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Portal } from "@mantine/core";
import type { Identity } from "./auth-session";
import { createWorkspaceStore } from "./workspace-storage";
import { browserWorkspaceStorage } from "./workspace-browser-storage";
import { WorkspaceContext } from "./workspace-preferences-context";

export function WorkspacePreferences({
  identity,
  children,
}: {
  identity: Identity;
  children: ReactNode;
}) {
  const [store] = useState(() => {
    const { storage, prefix } = browserWorkspaceStorage();
    return createWorkspaceStore(storage, prefix, identity.account);
  });
  const persistenceFailed = useSyncExternalStore(store.subscribe, store.getPersistenceFailed);
  const [warningDismissed, setWarningDismissed] = useState(false);
  useEffect(() => {
    const suspend = () => {
      store.setSuspended(true);
    };
    const resume = () => {
      store.setSuspended(false);
    };
    // Cancelled requests during navigation must not overwrite the last visible editing state.
    window.addEventListener("beforeunload", suspend);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("beforeunload", suspend);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", resume);
    };
  }, [store]);
  return (
    <WorkspaceContext value={store}>
      {children}
      {persistenceFailed && !warningDismissed ? (
        <Portal>
          <Alert
            role="alert"
            title="Reload protection unavailable"
            color="orange"
            withCloseButton
            closeButtonLabel="Dismiss reload warning"
            onClose={() => {
              setWarningDismissed(true);
            }}
            style={{
              position: "fixed",
              left: 16,
              right: 16,
              bottom: 16,
              maxWidth: 460,
              zIndex: "var(--mantine-z-index-max)",
            }}
          >
            This browser could not retain the latest workspace changes. Reloading may lose unsaved
            edits.
          </Alert>
        </Portal>
      ) : null}
    </WorkspaceContext>
  );
}
