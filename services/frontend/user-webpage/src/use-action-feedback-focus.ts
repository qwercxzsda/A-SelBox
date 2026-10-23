import { useEffect, useRef, type RefObject } from "react";

/** Recover focus after an action disables its control, unless the user has moved elsewhere. */
export function useActionFeedbackFocus(
  message: string | null,
  scope: RefObject<HTMLElement | null>,
) {
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!message) return;
    const active = document.activeElement;
    if (
      active === document.body ||
      active === document.documentElement ||
      scope.current?.contains(active)
    )
      feedback.current?.focus();
  }, [message, scope]);
  return feedback;
}
