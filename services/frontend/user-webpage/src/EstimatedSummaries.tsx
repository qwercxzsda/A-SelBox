import { SummaryCard } from "./SummaryCard";
import type { SummaryPeriod, SummaryState } from "./summary-types";
import { Alert, Button, Group, Modal, NativeSelect, Text, Title } from "@mantine/core";
import { useState } from "react";
import { DateFilter } from "./ColumnFilters";
import type { DateRange } from "./estimated-periods";
import { UpdateStatus } from "./UpdateStatus";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import "./EstimatedSummaries.css";

interface EstimatedSummariesProps {
  selectedCurrency: string | null;
  dateRange: DateRange;
  onCurrencyChange: (currency: string) => void;
  day: SummaryState;
  month: SummaryState;
  selected: SummaryState;
  selectionActive: boolean;
  loading: boolean;
  onRetry: () => void | Promise<void>;
  onPeriodSelect: (range: DateRange) => void;
  onOpenBreakdown: (period: SummaryPeriod, title: string, currency: string) => void;
  coverageNote?: string;
  appliedFilters?: SummaryFilter[];
}

export function EstimatedSummaries({
  selectedCurrency,
  dateRange,
  onCurrencyChange,
  day,
  month,
  selected,
  selectionActive,
  loading,
  onRetry,
  onPeriodSelect,
  onOpenBreakdown,
  coverageNote,
  appliedFilters = [],
}: EstimatedSummariesProps) {
  const [choosingDates, setChoosingDates] = useState(false);
  const periods = [day.period, month.period, selectionActive ? selected.period : null];
  const errors = [
    ...new Set(
      [day.error, month.error, selectionActive ? selected.error : null].filter(
        (error) => error !== null,
      ),
    ),
  ];
  const currency = selectedCurrency ?? "USD";
  const currencies = [
    ...new Set([
      currency,
      ...periods.flatMap((period) => period?.totals ?? []).map((total) => total.currency),
    ]),
  ].sort();

  return (
    <section className="estimated-summaries" aria-label="Estimated totals" aria-busy={loading}>
      <Group justify="space-between" align="center" mb={4}>
        <div>
          <Title order={2} className="ui-workspace-intro-title">
            Estimated totals
          </Title>
          <UpdateStatus active={loading && periods.some((period) => period !== null)}>
            Updating estimated totals…
          </UpdateStatus>
        </div>
        <NativeSelect
          label="Summary currency"
          className="estimated-summary-currency"
          size="xs"
          value={currency}
          data={currencies}
          onChange={(event) => {
            onCurrencyChange(event.currentTarget.value);
          }}
        />
      </Group>
      <SummaryFilters filters={appliedFilters} compact />
      {errors.length > 0 ? (
        <Alert color="red" role="alert" mb="sm">
          <Group justify="space-between" gap="xs">
            <div>
              {errors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </div>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => void onRetry()}>
              Retry summaries
            </Button>
          </Group>
        </Alert>
      ) : null}
      <div className="estimated-summary-grid">
        <SummaryCard
          title="Latest day"
          period={day.period}
          currency={currency}
          loading={day.pending}
          error={day.error}
          emptyMessage={
            appliedFilters.some((filter) => filter.values.length > 0)
              ? "No transactions match these filters."
              : "No transactions yet."
          }
          onPeriodSelect={onPeriodSelect}
          onOpenBreakdown={onOpenBreakdown}
        />
        <SummaryCard
          title="Latest month"
          period={month.period}
          currency={currency}
          loading={month.pending}
          error={month.error}
          emptyMessage="No full month available."
          onPeriodSelect={onPeriodSelect}
          onOpenBreakdown={onOpenBreakdown}
        />
        <SummaryCard
          title="Selected dates"
          period={selectionActive ? selected.period : null}
          currency={currency}
          loading={selectionActive && selected.pending}
          error={selectionActive ? selected.error : null}
          emptyMessage={
            selectionActive
              ? "No transactions for these dates."
              : "Select a date range to see totals."
          }
          onOpenBreakdown={onOpenBreakdown}
          onChooseDates={() => {
            setChoosingDates(true);
          }}
        />
      </div>
      {coverageNote ? (
        <Text size="xs" c="dimmed" mt="sm" role="note">
          {coverageNote}
        </Text>
      ) : null}
      <Modal
        opened={choosingDates}
        onClose={() => {
          setChoosingDates(false);
        }}
        title="Choose summary dates"
        centered
      >
        <DateFilter
          filter={{
            kind: "date",
            from: dateRange.from,
            to: dateRange.to,
            onChange: (from, to) => {
              onPeriodSelect({ from, to });
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
