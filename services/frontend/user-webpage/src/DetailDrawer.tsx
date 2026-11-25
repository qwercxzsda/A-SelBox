import { use, useEffect, useEffectEvent, useState, type ReactNode, type Ref } from "react";
import {
  Drawer,
  DrawerStackContext,
  VisuallyHidden,
  getDefaultZIndex,
  type DrawerRootProps,
} from "@mantine/core";
import { DrawerHeading } from "./DrawerHeading";

/** record: one record; wide: a working view with tables; full: a report. */
export type DrawerWidth = "record" | "wide" | "full";

type DetailDrawerProps = Pick<
  DrawerRootProps,
  | "opened"
  | "onClose"
  | "classNames"
  | "returnFocus"
  | "closeOnEscape"
  | "closeOnClickOutside"
  | "onEnterTransitionEnd"
  | "onExitTransitionEnd"
  | "id"
> & {
  /** "<Kind> details"; also names the dialog and its close button. */
  title: string;
  /** "identity · scope", shown under the title. */
  context: string;
  width: DrawerWidth;
  children?: ReactNode;
  /** Replaces the derived "Close <title>" when lowercasing would change a name (a month). */
  closeLabel?: string;
  /** Actions on the whole record (such as Edit), in the header left of the close button. */
  headerActions?: ReactNode;
  /** Places the drawer in the enclosing Drawer.Stack. */
  stackId?: string;
  titleRef?: Ref<HTMLSpanElement>;
  closeButtonRef?: Ref<HTMLButtonElement>;
  closeDisabled?: boolean;
};

const MODAL_Z_INDEX = getDefaultZIndex("modal");

/** Mantine's Drawer stacking, repeated here because this drawer composes its own header. */
function useDrawerStack(stackId: string | undefined, opened: boolean) {
  const stack = use(DrawerStackContext);
  const register = useEffectEvent((id: string, isOpened: boolean) => {
    if (!stack) return;
    if (isOpened) stack.addModal(id, MODAL_Z_INDEX);
    else stack.removeModal(id);
  });
  useEffect(() => {
    if (stackId) register(stackId, opened);
  }, [stackId, opened]);

  if (!stack || !stackId) return { root: { zIndex: MODAL_Z_INDEX }, overlayVisible: opened };
  const current = stack.currentId === stackId;
  return {
    root: {
      zIndex: stack.getZIndex(stackId),
      closeOnEscape: current,
      trapFocus: current,
      __handledEscapeEvents: stack.handledEscapeEvents,
    },
    overlayVisible: current,
    overlayTransition: { duration: 0 },
    hidden: opened && !current,
  };
}

/** The only drawer. Retain the visible record and its labels until the drawer finishes closing. */
export function DetailDrawer({
  opened,
  title,
  context,
  width,
  children,
  closeLabel,
  headerActions,
  stackId,
  titleRef,
  closeButtonRef,
  closeDisabled,
  returnFocus = true,
  ...props
}: DetailDrawerProps) {
  const [display, setDisplay] = useState({ title, context, closeLabel, headerActions, children });
  if (
    opened &&
    (display.title !== title ||
      display.context !== context ||
      display.closeLabel !== closeLabel ||
      display.headerActions !== headerActions ||
      display.children !== children)
  )
    setDisplay({ title, context, closeLabel, headerActions, children });
  const stack = useDrawerStack(stackId, opened);

  return (
    <Drawer.Root
      {...props}
      opened={opened}
      returnFocus={returnFocus}
      position="right"
      size={`var(--ui-drawer-width-${width})`}
      {...stack.root}
    >
      <Drawer.Overlay visible={stack.overlayVisible} transitionProps={stack.overlayTransition} />
      <Drawer.Content __hidden={stack.hidden}>
        <Drawer.Header>
          <Drawer.Title>
            <DrawerHeading title={display.title} context={display.context} titleRef={titleRef} />
          </Drawer.Title>
          {display.headerActions ? (
            <div className="detail-drawer-actions">{display.headerActions}</div>
          ) : null}
          <Drawer.CloseButton
            ref={closeButtonRef}
            disabled={closeDisabled}
            aria-label={display.closeLabel ?? `Close ${display.title.toLowerCase()}`}
          />
        </Drawer.Header>
        <Drawer.Body>
          {display.context ? <VisuallyHidden>{display.context}</VisuallyHidden> : null}
          {display.children}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
