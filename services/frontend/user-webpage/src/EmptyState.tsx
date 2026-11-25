import type { RefObject } from "react";
import { Button, Text } from "@mantine/core";
import "./EmptyState.css";

/** The one empty-list message: a short title and, when filters hide rows, a way back to them. */
export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: {
    label: string;
    onClick: () => void;
    /** The action removes this message; keyboard focus continues here. */
    focusTarget?: RefObject<HTMLElement | null>;
  };
}) {
  return (
    <div className="empty-state">
      <Text fw={600}>{title}</Text>
      {action ? (
        <Button
          variant="light"
          onClick={(event) => {
            if (event.detail === 0) action.focusTarget?.current?.focus();
            action.onClick();
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
