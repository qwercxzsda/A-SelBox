import { useEffect, useState, type RefObject } from "react";
import { Button, Group, Text } from "@mantine/core";
import "./TableScrollControls.css";

/** Keep wide-table navigation reachable without scrolling to the final record. */
export function TableScrollControls({
  target,
  targetId,
}: {
  target: RefObject<HTMLDivElement | null>;
  targetId: string;
}) {
  const [position, setPosition] = useState({ overflow: false, start: true, end: true });

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const update = () => {
      const remaining = element.scrollWidth - element.clientWidth;
      const next = {
        overflow: remaining > 1,
        start: element.scrollLeft < 1,
        end: element.scrollLeft >= remaining - 1,
      };
      setPosition((current) =>
        current.overflow === next.overflow &&
        current.start === next.start &&
        current.end === next.end
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [target]);

  if (!position.overflow) return null;
  function scroll(direction: number) {
    const element = target.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.75, behavior: "instant" });
  }

  return (
    <Group
      className="table-scroll-controls"
      gap={4}
      wrap="nowrap"
      role="group"
      aria-label="Scroll table columns"
    >
      <Text size="xs" c="dimmed">
        Columns
      </Text>
      {[
        { direction: -1, name: "left", label: "← Left", disabled: position.start },
        { direction: 1, name: "right", label: "Right →", disabled: position.end },
      ].map(({ direction, name, label, disabled }) => (
        <Button
          key={name}
          size="compact-xs"
          variant="subtle"
          aria-label={`Scroll table ${name}`}
          aria-controls={targetId}
          aria-disabled={disabled}
          data-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          onClick={() => {
            if (!disabled) scroll(direction);
          }}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
