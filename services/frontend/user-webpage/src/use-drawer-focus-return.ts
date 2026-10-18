import { useRef, type RefObject } from "react";

/** Restore a stacked drawer's opener after its exit transition finishes. */
export function useDrawerFocusReturn({
  opened,
  enabled = true,
  fallbackRef,
}: {
  opened: boolean;
  enabled?: boolean;
  fallbackRef?: RefObject<HTMLElement | null>;
}) {
  const opener = useRef<HTMLElement | null>(null);

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

  return { rememberOpener, restoreFocus };
}
