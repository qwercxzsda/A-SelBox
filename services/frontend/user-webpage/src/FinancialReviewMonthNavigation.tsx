import { Button, Group } from "@mantine/core";

const STEPS = [
  { key: "previous", label: "Previous month", path: "m10 3-5 5 5 5" },
  { key: "next", label: "Next month", path: "m6 3 5 5-5 5" },
] as const;

function StepArrow({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Steps to the year's previous or next month with activity, in the drawer header so it never
 * moves with the records. Narrow drawers show the arrows only; the names stay the same.
 * An unavailable step keeps focus but does nothing.
 */
export function FinancialReviewMonthNavigation({
  year,
  previous,
  next,
  onStep,
}: {
  year: number;
  /** YYYY-MM, or undefined at the first or last month with activity. */
  previous: string | undefined;
  next: string | undefined;
  onStep: (month: string) => void;
}) {
  const targets = { previous, next };
  return (
    <Group
      component="nav"
      aria-label={`Months in ${String(year)}`}
      className="financial-review-month-navigation"
      gap="xs"
      wrap="nowrap"
    >
      {STEPS.map(({ key, label, path }) => {
        const target = targets[key];
        const arrow = <StepArrow path={path} />;
        return (
          <Button
            key={key}
            variant="default"
            size="xs"
            className="financial-review-month-step"
            aria-label={label}
            aria-disabled={!target}
            data-disabled={!target || undefined}
            tabIndex={target ? undefined : -1}
            leftSection={key === "previous" ? arrow : undefined}
            rightSection={key === "next" ? arrow : undefined}
            onClick={() => {
              if (target) onStep(target);
            }}
          >
            <span className="financial-review-month-step-label">{label}</span>
          </Button>
        );
      })}
    </Group>
  );
}
