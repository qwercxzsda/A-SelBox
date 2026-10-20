import { useId } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { ColumnMenuFilter } from "./ColumnFilters";

export interface ColumnMenuSort {
  direction: "asc" | "desc" | false;
  onChange: (direction: "asc" | "desc") => void;
  ascendingLabel: string;
  descendingLabel: string;
  disabledReason?: string;
}

/** Keep ordering and selection completion together in the menu's sticky action area. */
export function ColumnMenuFooter({
  filterKind,
  sort,
  onClose,
}: {
  filterKind?: ColumnMenuFilter["kind"];
  sort?: ColumnMenuSort;
  onClose: () => void;
}) {
  const disabledSortId = useId();
  const selection = filterKind === "selection";
  if (!sort && !selection) return null;

  return (
    <Stack className="column-menu-footer" data-separated={Boolean(filterKind) || undefined} gap={4}>
      {sort
        ? (["desc", "asc"] as const).map((direction, index) => (
            <Button
              key={direction}
              variant={sort.direction === direction ? "light" : "subtle"}
              aria-pressed={sort.direction === direction}
              disabled={Boolean(sort.disabledReason)}
              aria-describedby={sort.disabledReason ? disabledSortId : undefined}
              data-autofocus={(!filterKind && !sort.disabledReason && index === 0) || undefined}
              justify="flex-start"
              fullWidth
              onClick={() => {
                sort.onChange(direction);
                onClose();
              }}
            >
              {direction === "asc" ? sort.ascendingLabel : sort.descendingLabel}
            </Button>
          ))
        : null}
      {sort?.disabledReason ? (
        <Text id={disabledSortId} size="sm" c="dimmed" role="note">
          {sort.disabledReason}
        </Text>
      ) : null}
      {selection ? (
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed">
            Changes apply immediately.
          </Text>
          <Button size="compact-sm" onClick={onClose}>
            Done
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
