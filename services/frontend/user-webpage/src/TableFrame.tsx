import { useId, useRef, type ReactNode } from "react";
import { Group, Paper } from "@mantine/core";
import { FloatingTableHeader } from "./FloatingTableHeader";
import { TableScrollControls } from "./TableScrollControls";
import "./TableFrame.css";

/** Shared frame and navigation; each table retains its own headers, rows, and data model. */
export function TableFrame({
  label,
  children,
  heading,
  status,
  isBusy,
  dataset,
  className,
  scrollClassName,
}: {
  label: string;
  children: ReactNode;
  heading?: ReactNode;
  status?: ReactNode;
  isBusy?: boolean;
  dataset?: string;
  className?: string;
  scrollClassName?: string;
}) {
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return (
    <>
      <FloatingTableHeader target={scrollTarget} />
      <Group
        className={heading ? "detail-section-header" : undefined}
        justify={heading ? "space-between" : "flex-end"}
        gap="xs"
        mb={heading ? "sm" : "xs"}
        mih={heading ? undefined : 22}
      >
        {heading}
        <TableScrollControls target={scrollTarget} targetId={scrollId} />
        {status}
      </Group>
      <Paper
        withBorder
        className={["table-card", className].filter(Boolean).join(" ")}
        data-dataset={dataset}
        aria-busy={isBusy}
      >
        <div
          id={scrollId}
          ref={scrollTarget}
          className={["table-horizontal-scroll", scrollClassName].filter(Boolean).join(" ")}
          role="region"
          aria-label={label}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can scroll wide tables.
          tabIndex={0}
        >
          {children}
        </div>
      </Paper>
    </>
  );
}
