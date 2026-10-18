import { useEffect, useEffectEvent, useRef, type RefObject } from "react";

/** Restore a stacked drawer's opener after its exit transition finishes. */
export function useDrawerFocusReturn({
  opened,
  enabled = true,
  fallbackRef,
  restoreOnClose = false,
}: {
  opened: boolean;
  enabled?: boolean;
  fallbackRef?: RefObject<HTMLElement | null>;
  restoreOnClose?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpened = useRef(opened);

  function rememberOpener() {
    if (enabled && !opened && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
  }

  function restoreFocus() {
    // Drawer.Stack can cancel its built-in focus return when a panel leaves the stack.
    if (!enabled || opened) return;
    const target = opener.current?.isConnected ? opener.current : fallbackRef?.current;
    opener.current = null;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement &&
      !active.closest('[role="dialog"]')
    )
      return;
    target?.focus({ preventScroll: true });
  }

  const restoreAfterClose = useEffectEvent(restoreFocus);
  useEffect(() => {
    if (restoreOnClose && wasOpened.current && !opened) restoreAfterClose();
    wasOpened.current = opened;
  }, [opened, restoreOnClose]);

  return { rememberOpener, restoreFocus };
}
