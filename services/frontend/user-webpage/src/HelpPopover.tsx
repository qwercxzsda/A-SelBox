import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { ActionIcon, CloseButton, Popover } from "@mantine/core";
import "./HelpPopover.css";

/** Optional guidance works with a pointer, keyboard, or touch without obscuring the page. */
export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const [mode, setMode] = useState<"closed" | "preview" | "pinned">("closed");
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const pointerInside = useRef(false);
  const restoringFocus = useRef(false);
  const contentId = useId();
  const opened = mode !== "closed";

  useEffect(
    () => () => {
      if (closeTimer.current !== null) globalThis.clearTimeout(closeTimer.current);
    },
    [],
  );

  function cancelClose() {
    if (closeTimer.current !== null) globalThis.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function contains(target: EventTarget | null) {
    return (
      target instanceof Node &&
      ((trigger.current?.contains(target) ?? false) ||
        (dropdown.current?.contains(target) ?? false))
    );
  }

  function close(restoreFocus = false) {
    cancelClose();
    setMode("closed");
    if (restoreFocus && trigger.current && document.activeElement !== trigger.current) {
      restoringFocus.current = true;
      trigger.current.focus({ preventScroll: true });
    }
  }

  function preview() {
    cancelClose();
    setMode((current) => (current === "closed" ? "preview" : current));
  }

  function leavePointer() {
    pointerInside.current = false;
    cancelClose();
    closeTimer.current = globalThis.setTimeout(() => {
      closeTimer.current = null;
      if (!pointerInside.current && !contains(document.activeElement))
        setMode((current) => (current === "preview" ? "closed" : current));
    }, 160);
  }

  function leaveFocus(event: FocusEvent<HTMLElement>) {
    if (event.relatedTarget && !contains(event.relatedTarget)) close();
  }

  function focusClose() {
    closeButton.current?.focus({ preventScroll: true });
  }

  function pin() {
    cancelClose();
    setMode("pinned");
    focusClose();
  }

  const dismissOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(dropdown.current?.contains(document.activeElement) ?? false);
  });

  useEffect(() => {
    if (!opened) return;
    // Hovered help must also dismiss when focus remains elsewhere on the page.
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [opened]);

  return (
    <Popover
      opened={opened}
      onChange={(next) => {
        if (!next) close();
      }}
      onEnterTransitionEnd={() => {
        if (mode === "pinned") focusClose();
      }}
      width="min(380px, calc(100vw - 32px))"
      position="bottom-start"
      floatingStrategy="fixed"
      preventPositionChangeWhenVisible={false}
      middlewares={{ shift: { crossAxis: true, padding: 16 } }}
      shadow="md"
      closeOnEscape={false}
      withinPortal
    >
      <Popover.Target>
        <ActionIcon
          ref={trigger}
          className="help-trigger"
          variant="subtle"
          color="gray"
          size={28}
          aria-label={label}
          aria-describedby={opened ? contentId : undefined}
          data-mantine-stop-propagation="true"
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            pointerInside.current = true;
            preview();
          }}
          onPointerLeave={leavePointer}
          onFocus={() => {
            if (restoringFocus.current) restoringFocus.current = false;
            else preview();
          }}
          onBlur={leaveFocus}
          onClick={() => {
            if (mode === "pinned") close();
            else pin();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && opened) {
              event.preventDefault();
              pin();
            }
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9.6 9a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 1.9-2.4 3.5" />
            <circle className="help-trigger-dot" cx="12" cy="16.5" r=".8" />
          </svg>
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown
        ref={dropdown}
        className="help-popover"
        aria-label={label}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          pointerInside.current = true;
          cancelClose();
        }}
        onPointerLeave={leavePointer}
        onBlur={leaveFocus}
        onFocusCapture={(event) => {
          cancelClose();
          event.target.setAttribute("data-mantine-stop-propagation", "true");
        }}
      >
        <CloseButton
          ref={closeButton}
          className="help-popover-close"
          size="sm"
          aria-label={`Close ${label}`}
          onClick={() => {
            close(true);
          }}
        />
        <div id={contentId} className="help-popover-content">
          {children}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
