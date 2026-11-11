import type { DateRange, PeriodDefinition } from "./summary-periods";
import type { TotalsPeriod } from "./summary-periods";
import { summaryDateLabel } from "./summary-date-label";

export function TotalsDateControl({
  period,
  definition,
  loading,
  onDatesChange,
  onChooseDates,
}: {
  period: TotalsPeriod;
  definition: PeriodDefinition | null;
  loading: boolean;
  onDatesChange: (range: DateRange) => void;
  onChooseDates: () => void;
}) {
  const editable = period === "selected";
  const label = definition
    ? `${editable ? summaryDateLabel(definition.range) : definition.label} · UTC`
    : editable
      ? "Choose dates · UTC"
      : loading
        ? "Loading period…"
        : "No transactions available";
  const action = editable
    ? definition
      ? `Change dates: ${label}`
      : label
    : definition
      ? `Filter transactions to ${label}`
      : label;

  return (
    <button
      type="button"
      className="totals-date-control"
      data-period={period}
      data-action={editable ? "select" : "filter"}
      title={editable ? "Choose a date range" : "Apply this period to transaction filters"}
      disabled={!editable && definition === null}
      aria-label={action}
      aria-haspopup={editable ? "dialog" : undefined}
      onClick={() => {
        if (editable) onChooseDates();
        else if (definition) onDatesChange(definition.range);
      }}
    >
      <svg
        className={editable ? "totals-calendar-icon" : "totals-filter-icon"}
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        {editable ? (
          <>
            <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
            <path d="M6.5 2.5v4M13.5 2.5v4M3 8.5h14" />
          </>
        ) : (
          <path d="M3 4h14l-5.5 6.5V17l-3-1.8v-4.7L3 4Z" strokeLinejoin="round" />
        )}
      </svg>
      <span className="totals-date-control-label">{label}</span>
      {editable ? (
        <svg
          className="totals-date-chevron"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      ) : null}
    </button>
  );
}
