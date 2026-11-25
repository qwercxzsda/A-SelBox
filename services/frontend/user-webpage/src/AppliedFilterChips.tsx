import type { RefObject } from "react";
import { Button, Text, Tooltip } from "@mantine/core";
import "./AppliedFilterChips.css";

interface FilterChip<Change> {
  key: string;
  label: string;
  clear: Change;
  ariaLabel?: string;
  description?: string;
}

/**
 * Shared removal and focus behavior; callers retain their filter values and labels.
 * Chips stay on one line (scrolling sideways when needed) inside the table's status row,
 * after the same count summary on every list: "1 filter applied", "2 filters applied".
 */
export function AppliedFilterChips<Change>({
  label,
  chips,
  onChange,
  onClearAll,
  focusTarget,
}: {
  label: string;
  chips: FilterChip<Change>[];
  onChange: (change: Change) => void;
  onClearAll?: () => void;
  focusTarget?: RefObject<HTMLElement | null>;
}) {
  if (!chips.length) return null;
  // A keyboard activation removes the focused chip; continue from the list's search field.
  function restoreKeyboardFocus(detail: number) {
    if (detail === 0) focusTarget?.current?.focus();
  }
  return (
    <div className="applied-filters" role="group" aria-label={label}>
      <Text className="applied-filters-summary" size="xs" c="dimmed">
        {chips.length} {chips.length === 1 ? "filter" : "filters"} applied
      </Text>
      <div className="applied-filters-chips">
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
              className="applied-filter-chip"
              variant="light"
              size="compact-xs"
              aria-label={chip.ariaLabel ?? `Remove ${chip.label}`}
              rightSection={<span aria-hidden="true">×</span>}
              onClick={(event) => {
                restoreKeyboardFocus(event.detail);
                onChange(chip.clear);
              }}
            >
              <span className="applied-filter-text">{chip.label}</span>
            </Button>
          </Tooltip>
        ))}
      </div>
      {onClearAll ? (
        <Button
          className="applied-filters-clear"
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
    </div>
  );
}
