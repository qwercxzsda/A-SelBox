import { useId, useRef, useState, type Ref } from "react";
import { SelectionFilter, type ColumnMenuFilter } from "./ColumnFilters";
import { DateFilter } from "./DateFilter";
import { MonthFilter } from "./MonthFilter";
import { TransactionTypeFilter } from "./TransactionTypeFilter";
import { ColumnMenuFooter, type ColumnMenuSort } from "./ColumnMenuFooter";
import { CloseButton, Group, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import "./ColumnMenu.css";

export type { ColumnMenuSort } from "./ColumnMenuFooter";

interface ColumnMenuProps {
  label: string;
  triggerRef?: Ref<HTMLButtonElement>;
  filter?: ColumnMenuFilter;
  sort?: ColumnMenuSort;
}

function activeColumnFilterCount(filter?: ColumnMenuFilter): number {
  switch (filter?.kind) {
    case "selection":
      return filter.value.length;
    case "date":
      return Number(Boolean(filter.from || filter.to));
    case "month":
      return Number(Boolean(filter.value));
    default:
      return 0;
  }
}

export function ColumnMenu({ label, triggerRef, filter, sort }: ColumnMenuProps) {
  const [opened, setOpened] = useState(false);
  const titleId = useId();
  const dropdown = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const filterCount = activeColumnFilterCount(filter);

  function close() {
    setOpened(false);
  }

  function resetScroll() {
    if (dropdown.current) dropdown.current.scrollTop = 0;
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={
        filter?.kind === "selection" && filter.groupBy === "transaction-type"
          ? "min(420px, calc(100vw - 24px))"
          : "min(340px, calc(100vw - 24px))"
      }
      position="bottom-start"
      floatingStrategy="fixed"
      preventPositionChangeWhenVisible={false}
      // Keep controls reachable when resizing or scrolling moves the column off-screen.
      middlewares={{ shift: { crossAxis: true, limiter: undefined, padding: 12 } }}
      shadow="md"
      trapFocus
      returnFocus
      withinPortal
      hideDetached={false}
    >
      <Popover.Target>
        <UnstyledButton
          ref={triggerRef}
          className="column-menu-trigger ui-surface-action"
          aria-label={filterCount > 0 ? `${label} ${String(filterCount)} selected` : label}
          data-filtered={filterCount > 0 || undefined}
          onClick={() => {
            setOpened(!opened);
          }}
        >
          <span>{label}</span>{" "}
          <span className="column-menu-indicators" aria-hidden="true">
            {filter ? (
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M2 3h12L9.5 8.3V13l-3-1.5V8.3Z" />
              </svg>
            ) : null}
            {filterCount > 0 ? <span className="column-menu-count">{filterCount}</span> : null}
            {sort ? (
              <span>{sort.direction === "asc" ? "↑" : sort.direction === "desc" ? "↓" : "↕"}</span>
            ) : null}
          </span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown
        ref={dropdown}
        className="column-menu-dropdown"
        aria-labelledby={titleId}
        onFocusCapture={(event) => {
          // Ancestor drawers inspect the focused target before this popover handles Escape.
          event.target.setAttribute("data-mantine-stop-propagation", "true");
        }}
      >
        <Stack gap="sm" p="md">
          <Group className="column-menu-heading" justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm" id={titleId}>
              {label} options
            </Text>
            <CloseButton ref={closeButton} aria-label="Close options" onClick={close} />
          </Group>
          {opened && filter?.kind === "date" ? (
            <DateFilter filter={filter} onClose={close} />
          ) : null}
          {opened && filter?.kind === "month" ? (
            <MonthFilter filter={filter} onClose={close} />
          ) : null}
          {opened && filter?.kind === "selection" ? (
            filter.groupBy === "transaction-type" ? (
              <TransactionTypeFilter filter={filter} onResetScroll={resetScroll} />
            ) : (
              <SelectionFilter
                label={label}
                filter={filter}
                onResetScroll={resetScroll}
                onClearFocusFallback={() => closeButton.current?.focus()}
              />
            )
          ) : null}
          <ColumnMenuFooter filterKind={filter?.kind} sort={sort} onClose={close} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
