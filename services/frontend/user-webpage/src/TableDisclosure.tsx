import { Button } from "@mantine/core";
import { DisclosureChevron } from "./DisclosureChevron";
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
      className="table-disclosure ui-disclosure"
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={`${label} for ${context}`}
      leftSection={<DisclosureChevron expanded={expanded} />}
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
