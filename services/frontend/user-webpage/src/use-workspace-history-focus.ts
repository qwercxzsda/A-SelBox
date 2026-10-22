import { useContext, useEffect, useRef } from "react";
import { WorkspaceNavigationRevisionContext } from "./workspace-preferences-context";

/** Give restored workspace navigation a focus target without overriding a restored dialog. */
export function useWorkspaceHistoryFocus() {
  const navigationRevision = useContext(WorkspaceNavigationRevisionContext);
  const activeTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (navigationRevision === 0) return;
    // Descendant autofocus runs before the workspace supplies its fallback.
    const timeout = window.setTimeout(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused === document.documentElement) {
        activeTab.current?.focus({ preventScroll: true });
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [navigationRevision]);
  return activeTab;
}
