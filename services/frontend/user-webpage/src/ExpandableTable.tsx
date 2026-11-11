import { useId, useRef, type ReactNode } from "react";
import { ActionIcon, Button, Group, Paper, Table, Tooltip, VisuallyHidden } from "@mantine/core";
import { FloatingTableHeader } from "./FloatingTableHeader";
import { TableScrollControls } from "./TableScrollControls";
import "./FinancialTable.css";
import "./ExpandableTable.css";

export interface ExpandableColumn {
  key: string;
  label: string;
  align?: "right";
  width?: number | string;
  header?: ReactNode;
  ariaSort?: "ascending" | "descending" | "none";
}

export function ExpandableTable({
  label,
  columns,
  children,
  emptyState,
  minWidth = 700,
  actionsWidth,
  onCollapseAll,
}: {
  label: string;
  columns: readonly ExpandableColumn[];
  children: ReactNode;
  emptyState?: ReactNode;
  minWidth?: number;
  actionsWidth?: number;
  onCollapseAll?: () => void;
}) {
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return (
    <>
      <FloatingTableHeader target={scrollTarget} />
      <Group justify={onCollapseAll ? "space-between" : "flex-end"} gap="xs" mb="xs" mih={22}>
        {onCollapseAll ? (
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              scrollTarget.current?.focus({ preventScroll: true });
              onCollapseAll();
            }}
          >
            Collapse all
          </Button>
        ) : null}
        <TableScrollControls target={scrollTarget} targetId={scrollId} />
      </Group>
      <Paper withBorder className="table-card">
        <div
          id={scrollId}
          ref={scrollTarget}
          className="table-horizontal-scroll"
          role="region"
          aria-label={`${label} table`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can scroll wide tables.
          tabIndex={0}
        >
          <Table className="expandable-table" aria-label={label} miw={minWidth}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th
                  scope="col"
                  className="expandable-toggle-cell"
                  data-floating-header-label=""
                >
                  <VisuallyHidden>Details</VisuallyHidden>
                </Table.Th>
                {columns.map((column) => (
                  <Table.Th
                    key={column.key}
                    scope="col"
                    className={column.align === "right" ? "numeric" : undefined}
                    style={{ width: column.width }}
                    aria-sort={column.ariaSort}
                  >
                    {column.header ?? column.label}
                  </Table.Th>
                ))}
                {actionsWidth !== undefined ? (
                  <Table.Th scope="col" className="numeric" style={{ width: actionsWidth }}>
                    Actions
                  </Table.Th>
                ) : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{children}</Table.Tbody>
          </Table>
          {emptyState ? <div className="expandable-table-empty">{emptyState}</div> : null}
        </div>
      </Paper>
    </>
  );
}

/** Inline disclosure keeps its summary row and keyboard focus in place. */
export function ExpandableTableRow({
  expanded,
  onToggle,
  toggleLabel,
  detailsLabel,
  disclosureText = "details",
  columnCount,
  children,
  actions,
  details,
}: {
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  detailsLabel: string;
  disclosureText?: string;
  columnCount: number;
  children: ReactNode;
  actions?: ReactNode;
  details: ReactNode;
}) {
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  function toggle() {
    toggleRef.current?.focus({ preventScroll: true });
    onToggle();
  }
  return (
    <>
      <Table.Tr
        className="expandable-summary-row"
        data-expanded={expanded || undefined}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "button, a, input, select, textarea, [role='button'], [contenteditable='true']",
            )
          )
            return;
          if (window.getSelection()?.type === "Range") return;
          toggle();
        }}
      >
        <Table.Td className="expandable-toggle-cell">
          <Tooltip label={`${expanded ? "Hide" : "Show"} ${disclosureText}`}>
            <ActionIcon
              ref={toggleRef}
              variant="subtle"
              color="gray"
              size={28}
              className="expandable-row-toggle ui-surface-action"
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              aria-label={`${expanded ? "Hide" : "Show"} ${toggleLabel}`}
              onClick={toggle}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="m6 3 5 5-5 5" />
              </svg>
            </ActionIcon>
          </Tooltip>
        </Table.Td>
        {children}
        {actions ? (
          <Table.Td>
            <Group gap="xs" justify="flex-end" wrap="nowrap" className="expandable-row-actions">
              {actions}
            </Group>
          </Table.Td>
        ) : null}
      </Table.Tr>
      {expanded ? (
        <Table.Tr className="expandable-detail-row">
          <Table.Td colSpan={columnCount}>
            <section id={detailsId} className="expandable-detail-panel" aria-label={detailsLabel}>
              {details}
            </section>
          </Table.Td>
        </Table.Tr>
      ) : null}
    </>
  );
}
