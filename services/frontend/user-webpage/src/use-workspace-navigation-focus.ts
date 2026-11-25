import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { WorkspaceNavigationRevisionContext } from "./workspace-preferences-context";

/** Keep navigation focus meaningful without overriding a clicked tab or a restored dialog. */
export function useWorkspaceNavigationFocus(dataset: string) {
  const navigationRevision = useContext(WorkspaceNavigationRevisionContext);
  const activeTab = useRef<HTMLButtonElement>(null);
  const previousDataset = useRef(dataset);
  // A phone-width tab bar scrolls sideways; keep the selected tab inside it without page scroll.
  useLayoutEffect(() => {
    const tab = activeTab.current;
    const list = tab?.parentElement;
    if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
    const tabBounds = tab.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (tabBounds.left < listBounds.left) list.scrollLeft -= listBounds.left - tabBounds.left;
    else if (tabBounds.right > listBounds.right)
      list.scrollLeft += tabBounds.right - listBounds.right;
  }, [dataset]);
  useEffect(() => {
    const changedTab = previousDataset.current !== dataset;
    previousDataset.current = dataset;
    if (navigationRevision === 0 && !changedTab) return;
    // Descendant autofocus runs before the workspace supplies its fallback.
    const timeout = window.setTimeout(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused === document.documentElement) {
        activeTab.current?.focus({ preventScroll: !changedTab });
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [dataset, navigationRevision]);
  return activeTab;
}
