import { useId, useRef, useState } from "react";
import { DateFilter, SelectionFilter, type ColumnMenuFilter } from "./ColumnFilters";
import { MonthFilter } from "./MonthFilter";
import { TransactionTypeFilter } from "./TransactionTypeFilter";
import { Button, CloseButton, Group, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import "./ColumnMenu.css";

export interface ColumnMenuSort {
  direction: "asc" | "desc" | false;
  onChange: (direction: "asc" | "desc") => void;
  ascendingLabel: string;
  descendingLabel: string;
  disabledReason?: string;
}

interface ColumnMenuProps {
  label: string;
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

export function ColumnMenu({ label, filter, sort }: ColumnMenuProps) {
  const [opened, setOpened] = useState(false);
  const titleId = useId();
  const disabledSortId = useId();
  const dropdown = useRef<HTMLDivElement>(null);
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
          className="column-menu-trigger ui-surface-action"
          aria-label={label}
          data-filtered={filterCount > 0 || undefined}
          onClick={() => {
            setOpened(!opened);
          }}
        >
          <span>{label}</span>
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
      <Popover.Dropdown ref={dropdown} className="column-menu-dropdown" aria-labelledby={titleId}>
        <Stack gap="sm" p="md">
          <Group className="column-menu-heading" justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm" id={titleId}>
              {label} options
            </Text>
            <CloseButton aria-label="Close options" onClick={close} />
          </Group>
          {opened && filter?.kind === "date" ? (
            <DateFilter filter={filter} onClose={close} />
          ) : null}
          {opened && filter?.kind === "month" ? (
            <MonthFilter filter={filter} onClose={close} />
          ) : null}
          {opened && filter?.kind === "selection" ? (
            filter.groupBy === "transaction-type" ? (
              <TransactionTypeFilter filter={filter} onClose={close} onResetScroll={resetScroll} />
            ) : (
              <SelectionFilter label={label} filter={filter} onResetScroll={resetScroll} />
            )
          ) : null}
          {sort ? (
            <Stack
              className="column-menu-footer"
              data-separated={Boolean(filter) || undefined}
              gap={4}
            >
              {(["desc", "asc"] as const).map((direction, index) => (
                <Button
                  key={direction}
                  variant={sort.direction === direction ? "light" : "subtle"}
                  aria-pressed={sort.direction === direction}
                  disabled={Boolean(sort.disabledReason)}
                  aria-describedby={sort.disabledReason ? disabledSortId : undefined}
                  data-autofocus={(!filter && !sort.disabledReason && index === 0) || undefined}
                  justify="flex-start"
                  fullWidth
                  onClick={() => {
                    sort.onChange(direction);
                    close();
                  }}
                >
                  {direction === "asc" ? sort.ascendingLabel : sort.descendingLabel}
                </Button>
              ))}
              {sort.disabledReason ? (
                <Text id={disabledSortId} size="sm" c="dimmed" role="note">
                  {sort.disabledReason}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
