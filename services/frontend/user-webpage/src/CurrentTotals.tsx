import type { MarketplaceSummary, OpenSummaryBreakdown, SummaryState } from "./summary-types";
import { Alert, Button, Group, Modal, Text, Title } from "@mantine/core";
import { useState, type CSSProperties } from "react";
import { DateFilter } from "./DateFilter";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import { MarketplaceTotalsTable } from "./MarketplaceTotalsTable";
import { TotalsDateControl } from "./TotalsDateControl";
import { HelpPopover } from "./HelpPopover";
import { LoadingStatus } from "./LoadingStatus";
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
}: CurrentTotalsProps) {
  const [choosingDates, setChoosingDates] = useState(false);
  const errors = [
    ...new Set(
      TOTALS_PERIODS.map((period) => states[period].error).filter((error) => error !== null),
    ),
  ];

  return (
    <section className="current-totals" aria-label="Current totals" aria-busy={loading}>
      <div className="totals-heading">
        <div className="totals-heading-title">
          <Title order={3} className="totals-section-title">
            Current totals
          </Title>
          <HelpPopover label="Current totals help">
            <p>
              Totals sum the matching transactions from Finances and Data Kiosk. Select a company
              amount to open its breakdown and records.
            </p>
            <p>
              Last day and Last month are the previous UTC calendar periods based on the latest
              accessible transaction, independent of filters.
            </p>
            <p>
              Totals use all selected filters and search. Last day and Last month use their own UTC
              periods; Selected dates uses the transaction list's date range.
            </p>
            <p>Records missing ownership or fees are excluded from known company amounts.</p>
          </HelpPopover>
          <span className="totals-market-count">
            {groups.length} {groups.length === 1 ? "marketplace" : "marketplaces"}
          </span>
          <LoadingStatus state={loading ? "updating" : null} />
        </div>
      </div>
      {appliedFilters.length > 0 ? (
        <div className="totals-scope">
          <SummaryFilters filters={appliedFilters} compact />
        </div>
      ) : null}
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
      <Modal
        opened={choosingDates}
        onClose={() => {
          setChoosingDates(false);
        }}
        title="Choose summary dates"
        closeButtonProps={{ "aria-label": "Close summary dates" }}
        centered
      >
        <Text size="sm" c="dimmed" mb="sm">
          These UTC dates also filter the transaction list.
        </Text>
        <DateFilter
          filter={{
            kind: "date",
            from: dateRange.from,
            to: dateRange.to,
            onChange: (from, to) => {
              onDatesChange({ from, to });
            },
          }}
          onClose={() => {
            setChoosingDates(false);
          }}
        />
      </Modal>
    </section>
  );
}
