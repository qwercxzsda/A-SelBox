import { useState } from "react";
import { Drawer, type DrawerProps } from "@mantine/core";

type DetailDrawerProps = Pick<
  DrawerProps,
  | "opened"
  | "onClose"
  | "title"
  | "children"
  | "size"
  | "classNames"
  | "returnFocus"
  | "onExitTransitionEnd"
> & { closeLabel: string };

/** Retain the visible record and its labels until the drawer finishes closing. */
export function DetailDrawer({
  opened,
  title,
  children,
  closeLabel,
  returnFocus = true,
  ...props
}: DetailDrawerProps) {
  const [display, setDisplay] = useState({ title, children, closeLabel });
  if (
    opened &&
    (display.title !== title || display.children !== children || display.closeLabel !== closeLabel)
  )
    setDisplay({ title, children, closeLabel });

  return (
    <Drawer
      {...props}
      opened={opened}
      returnFocus={returnFocus}
      position="right"
      padding="lg"
      title={display.title}
      closeButtonProps={{ "aria-label": display.closeLabel }}
    >
      {display.children}
    </Drawer>
  );
}
