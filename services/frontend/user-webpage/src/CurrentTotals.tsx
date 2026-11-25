import type { MarketplaceSummary, OpenSummaryBreakdown, SummaryState } from "./summary-types";
import { Title } from "@mantine/core";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { SummaryFilter } from "./SummaryFilters";
import { AlertTable } from "./AlertTable";
import { ErrorAlert } from "./ErrorAlert";
import { MarketplaceTotalsTable } from "./MarketplaceTotalsTable";
import { TotalsDateControl } from "./TotalsDateControl";
import { TransactionSummaryHeading } from "./TransactionSummaryHeading";
import { SummaryDatePicker } from "./SummaryDatePicker";
import {
  TOTALS_PERIODS,
  TOTALS_PERIOD_LABELS,
  type DateRange,
  type TotalsPeriod,
} from "./summary-periods";
import "./CurrentTotals.css";

interface TotalsFailure {
  period: string;
  cause: string;
}

const FAILURE_COLUMNS = [
  { key: "period", label: "Period", value: ({ period }: TotalsFailure) => period },
  { key: "cause", label: "Cause", value: ({ cause }: TotalsFailure) => cause },
] as const;

/** One cause is said once, after the periods it hit unless it hit them all; else a table. */
function failureDetail(failures: TotalsFailure[]): ReactNode {
  const causes = new Set(failures.map(({ cause }) => cause));
  if (causes.size === 1) {
    const [cause] = causes;
    if (failures.length === TOTALS_PERIODS.length) return cause;
    return `${failures.map(({ period }) => period).join(", ")}: ${cause}`;
  }
  return (
    <AlertTable
      label="Failed totals"
      columns={FAILURE_COLUMNS}
      rows={failures}
      rowKey={({ period }) => period}
    />
  );
}

interface CurrentTotalsProps {
  groups: MarketplaceSummary[];
  states: Record<TotalsPeriod, SummaryState>;
  dateRange: DateRange;
  loading: boolean;
  onRetry: () => void | Promise<void>;
  onDatesChange: (range: DateRange) => void;
  onOpenBreakdown: OpenSummaryBreakdown;
  appliedFilters: SummaryFilter[];
  controls: ReactNode;
}

export function CurrentTotals({
  groups,
  states,
  dateRange,
  loading,
  onRetry,
  onDatesChange,
  onOpenBreakdown,
  appliedFilters,
  controls,
}: CurrentTotalsProps) {
  const [choosingDates, setChoosingDates] = useState(false);
  const failures = TOTALS_PERIODS.flatMap((period) => {
    const cause = states[period].error;
    return cause === null ? [] : [{ period: TOTALS_PERIOD_LABELS[period], cause }];
  });

  return (
    <section className="current-totals" aria-label="Current totals" aria-busy={loading}>
      <TransactionSummaryHeading
        title="Current totals"
        count={groups.length}
        loading={loading}
        controls={controls}
        appliedFilters={appliedFilters}
        help={
          <>
            <p>
              Totals sum the matching transactions from Finances and its matched reference rows.
              Select a company amount to open its breakdown and records.
            </p>
            <p>
              Totals use all selected filters and search. Last day and Last month are the previous
              UTC calendar periods based on the latest accessible transaction, independent of
              filters; Selected dates uses the transaction list's date range.
            </p>
            <p>
              A company amount marked "N missing fee rates" leaves out N records without a fee rate.
              Add the rates in Current fees.
            </p>
          </>
        }
      />
      {failures.length > 0 ? (
        <ErrorAlert
          title="Could not load current totals"
          detail={failureDetail(failures)}
          onRetry={() => void onRetry()}
        />
      ) : null}
      <div
        className="totals-cards-grid"
        style={
          {
            "--totals-card-rows": groups.length + 2,
            "--totals-table-rows": groups.length + 1,
          } as CSSProperties
        }
      >
        {TOTALS_PERIODS.map((period) => {
          const title = TOTALS_PERIOD_LABELS[period];
          const state = states[period];
          return (
            <article key={period} className="totals-period-card" aria-label={`${title} totals`}>
              <div className="totals-card-heading">
                <div className="totals-card-title">
                  <Title order={4} className="totals-card-label">
                    {title}
                  </Title>
                </div>
                <TotalsDateControl
                  period={period}
                  definition={state.definition}
                  loading={state.pending}
                  onDatesChange={onDatesChange}
                  onChooseDates={() => {
                    setChoosingDates(true);
                  }}
                />
              </div>
              <MarketplaceTotalsTable {...{ groups, period, state, onOpenBreakdown }} />
            </article>
          );
        })}
      </div>
      <SummaryDatePicker
        opened={choosingDates}
        onClose={() => {
          setChoosingDates(false);
        }}
        dateRange={dateRange}
        onDatesChange={onDatesChange}
      />
    </section>
  );
}
