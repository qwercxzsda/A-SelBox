import { Button } from "@mantine/core";
import "./TableDisclosure.css";

/** One disclosure style and keyboard behavior for expandable table groups. */
export function TableDisclosure({
  expanded,
  subject,
  context,
  controlsId,
  onToggle,
}: {
  expanded: boolean;
  subject: string;
  context: string;
  controlsId?: string;
  onToggle: () => void;
}) {
  const label = `${expanded ? "Hide" : "Show"} ${subject}`;
  return (
    <Button
      type="button"
      variant="subtle"
      size="compact-xs"
      className="table-disclosure ui-text-action"
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={`${label} for ${context}`}
      leftSection={
        <svg
          className="table-disclosure-chevron"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
          data-expanded={expanded}
        >
          <path
            d="m6 3 5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      }
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onToggle();
      }}
    >
      {label}
    </Button>
  );
}
