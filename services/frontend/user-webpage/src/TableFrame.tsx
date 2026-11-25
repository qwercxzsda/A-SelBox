import { useId, useRef, type ReactNode } from "react";
import { Group, Paper } from "@mantine/core";
import { FloatingTableHeader } from "./FloatingTableHeader";
import { TableScrollControls } from "./TableScrollControls";
import { useScrollReserve } from "./scroll-reserve";
import "./TableFrame.css";

/** Shared frame and navigation; each table retains its own headers, rows, and data model. */
export function TableFrame({
  label,
  children,
  appliedFilters,
  status,
  isBusy = false,
  isPlaceholderData = false,
  dataset,
  className,
  scrollClassName,
}: {
  label: string;
  children: ReactNode;
  /** Applied-filter chips; their row keeps one chip line whether or not filters exist. */
  appliedFilters?: ReactNode;
  status?: ReactNode;
  isBusy?: boolean;
  /** The previous result stays visible, dimmed and inactive, until the next one arrives. */
  isPlaceholderData?: boolean;
  dataset?: string;
  className?: string;
  scrollClassName?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  useScrollReserve(card);
  return (
    <>
      <FloatingTableHeader target={scrollTarget} />
      <div className="table-status-row">
        <div className="table-status-filters">{appliedFilters}</div>
        <Group className="table-status-actions" gap="xs" wrap="nowrap">
          <TableScrollControls target={scrollTarget} targetId={scrollId} />
          {status}
        </Group>
      </div>
      <Paper
        ref={card}
        withBorder
        className={["table-card", className].filter(Boolean).join(" ")}
        data-dataset={dataset}
        data-placeholder={isPlaceholderData || undefined}
        aria-busy={isBusy || isPlaceholderData}
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
