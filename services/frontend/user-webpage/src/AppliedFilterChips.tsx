import type { RefObject } from "react";
import { Button, Group, Text, Tooltip } from "@mantine/core";
import "./AppliedFilterChips.css";

interface FilterChip<Change> {
  key: string;
  label: string;
  clear: Change;
  ariaLabel?: string;
  description?: string;
}

/** Shared removal and focus behavior; callers retain their filter values and labels. */
export function AppliedFilterChips<Change>({
  label,
  chips,
  onChange,
  focusTarget,
  summary = "Applied filters",
  summarized = false,
  onClearAll,
}: {
  label: string;
  chips: FilterChip<Change>[];
  onChange: (change: Change) => void;
  focusTarget?: RefObject<HTMLElement | null>;
  summary?: string;
  summarized?: boolean;
  onClearAll?: () => void;
}) {
  if (!chips.length) return null;
  function restoreKeyboardFocus(detail: number) {
    if (detail === 0) focusTarget?.current?.focus();
  }
  return (
    <Group
      className={summarized ? "applied-table-filters" : undefined}
      gap="xs"
      mb={summarized ? "xs" : "sm"}
      role="group"
      aria-label={label}
    >
      <Text size="xs" c="dimmed">
        {summary}
      </Text>
      {chips.map((chip) => (
        <Tooltip
          key={chip.key}
          label={chip.description}
          disabled={!chip.description}
          multiline
          maw="min(420px, calc(100vw - 24px))"
          withArrow
          events={{ hover: true, focus: true, touch: false }}
        >
          <Button
            className={summarized ? "applied-table-filter" : "applied-filter-chip"}
            variant="light"
            size="compact-xs"
            aria-label={chip.ariaLabel ?? `Remove ${chip.label}`}
            rightSection={<span aria-hidden="true">×</span>}
            onClick={(event) => {
              restoreKeyboardFocus(event.detail);
              onChange(chip.clear);
            }}
          >
            {summarized ? (
              <span className="applied-table-filter-text">{chip.label}</span>
            ) : (
              chip.label
            )}
          </Button>
        </Tooltip>
      ))}
      {onClearAll ? (
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={(event) => {
            restoreKeyboardFocus(event.detail);
            onClearAll();
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </Group>
  );
}
