import type { MarketplaceSummary, OpenSummaryBreakdown, SummaryState } from "./summary-types";
import { Alert, Button, Group, Modal, Text, Title } from "@mantine/core";
import { useState, type CSSProperties } from "react";
import { DateFilter } from "./DateFilter";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import { MarketplaceTotalsTable } from "./MarketplaceTotalsTable";
import { TotalsDateControl } from "./TotalsDateControl";
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
  coverageNote: string;
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
  coverageNote,
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
          <Title order={2} className="ui-workspace-intro-title">
            Current totals
          </Title>
          <span className="totals-market-count">
            {groups.length} {groups.length === 1 ? "marketplace" : "marketplaces"}
          </span>
          <span className="totals-update" role="status">
            {loading ? "Updating…" : ""}
          </span>
        </div>
      </div>
      <div className="totals-scope">
        <SummaryFilters
          filters={appliedFilters}
          compact
          emptyLabel="Finances and Data Kiosk only"
        />
      </div>
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
            "--totals-card-rows": groups.length + 3,
            "--totals-table-rows": groups.length + 1,
          } as CSSProperties
        }
      >
        {TOTALS_PERIODS.map((period) => {
          const title = TOTALS_PERIOD_LABELS[period];
          const available = groups.filter((group) => group[period].length > 0).length;
          const state = states[period];
          return (
            <article key={period} className="totals-period-card" aria-label={`${title} totals`}>
              <div className="totals-card-heading">
                <div className="totals-card-title">
                  <Title order={3}>{title}</Title>
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
              <div className="totals-card-footer">
                {state.pending
                  ? "Loading totals…"
                  : `${String(available)} of ${String(groups.length)} with totals`}
              </div>
            </article>
          );
        })}
      </div>
      <div className="totals-footer">
        <span>Finances + Data Kiosk · Select a company amount for its breakdown.</span>
        <details>
          <summary>About these totals</summary>
          <Text size="xs" c="dimmed" mt="xs">
            Totals and their records exclude SelBox amounts. Every marketplace uses the UTC period
            shown at the top of each card. Last day and month are based on the latest accessible
            transaction, independent of filters. Uncalculated records are excluded from known
            company amounts. {coverageNote}
          </Text>
        </details>
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
