import type { MarketplaceSummary, OpenSummaryBreakdown, SummaryState } from "./summary-types";
import { Alert, Button, Group, Title } from "@mantine/core";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { SummaryFilter } from "./SummaryFilters";
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
  const errors = [
    ...new Set(
      TOTALS_PERIODS.map((period) => states[period].error).filter((error) => error !== null),
    ),
  ];

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
              Last day and Last month are the previous UTC calendar periods based on the latest
              accessible transaction, independent of filters.
            </p>
            <p>
              Totals use all selected filters and search. Last day and Last month use their own UTC
              periods; Selected dates uses the transaction list's date range.
            </p>
            <p>Known company amounts exclude records with a missing fee rate.</p>
          </>
        }
      />
      {errors.length > 0 ? (
        <Alert color="red" role="alert" mb="sm">
          <Group justify="space-between" gap="xs">
            <div>
              {errors.length === 1 ? (
                errors[0]
              ) : (
                <details>
                  <summary>Some marketplace totals are unavailable</summary>
                  {errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </details>
              )}
            </div>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => void onRetry()}>
              Retry summaries
            </Button>
          </Group>
        </Alert>
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
