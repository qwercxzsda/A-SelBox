import { Button, Skeleton, Title } from "@mantine/core";
import { useState, type ReactNode } from "react";
import type { TransactionTrendTotal, TransactionTrendGranularity } from "./api/types";
import type { DateRange, PeriodDefinition } from "./summary-periods";
import type { SummaryFilter } from "./SummaryFilters";
import { ErrorAlert } from "./ErrorAlert";
import { TransactionSummaryHeading } from "./TransactionSummaryHeading";
import { SummaryDatePicker } from "./SummaryDatePicker";
import { TotalsDateControl } from "./TotalsDateControl";
import { TransactionTrendChart } from "./TransactionTrendChart";
import type { TypeGroupId } from "./transaction-type-families";
import { TRANSACTION_TREND_LABELS } from "./transaction-trend-periods";
import "./TransactionTrends.css";

export function TransactionTrends({
  rows,
  granularity,
  definition,
  marketplaceOrder,
  dateRange,
  pending,
  loading,
  error,
  controls,
  appliedFilters,
  onDatesChange,
  onRetry,
  onOpenBreakdown,
  onShowFilters,
}: {
  rows: TransactionTrendTotal[];
  granularity: TransactionTrendGranularity;
  definition: PeriodDefinition | null;
  marketplaceOrder: string[];
  dateRange: DateRange;
  pending: boolean;
  loading: boolean;
  error: string | null;
  controls: ReactNode;
  appliedFilters: SummaryFilter[];
  onDatesChange: (range: DateRange) => void;
  onRetry: () => void | Promise<void>;
  onShowFilters: () => void;
  onOpenBreakdown: (
    range: DateRange,
    marketplace: string,
    currency: string,
    focusedGroup?: TypeGroupId,
  ) => void;
}) {
  const [choosingDates, setChoosingDates] = useState(false);
  const title = TRANSACTION_TREND_LABELS[granularity];
  const groups = marketplaceOrder.map((marketplace) => ({
    marketplace,
    rows: rows.filter((row) => row.marketplace === marketplace),
  }));
  return (
    <section className="current-totals transaction-trends" aria-label={title} aria-busy={loading}>
      <TransactionSummaryHeading
        title={title}
        count={groups.length}
        loading={loading}
        controls={controls}
        appliedFilters={appliedFilters}
        help={
          <>
            <p>
              Bars show each type group's contribution for each UTC{" "}
              {granularity === "day" ? "day" : "week"}. A hatched segment distinguishes nonzero
              service fees. The black line shows the company total for each period; amounts do not
              accumulate.
            </p>
            <p>
              All transaction filters and search apply. Select dates to change the range; clear
              dates to restore the default.
            </p>
            <p>
              {granularity === "day"
                ? "The default is the last 30 days through Last day."
                : "The default is the last 12 complete calendar months through Last month. Weeks start on Monday; boundary weeks include only dates within the range."}{" "}
              These periods use the latest accessible transaction, independently of filters.
            </p>
            <p>
              Select a bar or a group's company amount to open Transaction totals at its Amounts by
              type group. Use the arrow keys to move between periods in the chart. Groups match Type
              filters. Charts include known company amounts; Reported amount in the details includes
              all matching transactions. Periods without a known company amount are gaps.
            </p>
          </>
        }
      />
      {error ? (
        <ErrorAlert
          title={`Could not load ${title.toLowerCase()}`}
          detail={error}
          onRetry={() => void onRetry()}
        />
      ) : null}
      <article
        className="totals-period-card transaction-trends-card"
        aria-label={`${title} company amounts`}
      >
        <div className="totals-card-heading">
          <Title order={4} className="totals-card-label">
            Company amount by {granularity === "day" ? "day" : "week"}
          </Title>
          <div className="transaction-trends-actions">
            <TotalsDateControl
              period="selected"
              definition={definition}
              loading={pending}
              onDatesChange={onDatesChange}
              onChooseDates={() => {
                setChoosingDates(true);
              }}
            />
            <Button variant="subtle" size="compact-sm" onClick={onShowFilters}>
              Search &amp; filters <span aria-hidden="true"> ↓</span>
            </Button>
          </div>
        </div>
        {groups.map((group) => (
          <div
            className="transaction-trends-marketplace"
            data-marketplace={group.marketplace}
            data-empty={(!pending && !error && (!group.rows.length || !definition)) || undefined}
            key={group.marketplace}
          >
            <div className="transaction-trends-market-heading">
              <span className="totals-marketplace-name">{group.marketplace}</span>
              {pending ? (
                <Skeleton
                  height={10}
                  width={65}
                  aria-label={`Loading ${group.marketplace} trends`}
                />
              ) : error || !group.rows.length || !definition ? (
                <span className="totals-empty-value">
                  {error ? "Unavailable" : "No transactions"}
                </span>
              ) : null}
            </div>
            {!pending && !error && group.rows.length > 0 && definition
              ? [...new Set(group.rows.map((row) => row.currency))].sort().map((currency) => (
                  <TransactionTrendChart
                    key={`${granularity}:${currency}:${JSON.stringify(definition.range)}`}
                    rows={group.rows.filter((row) => row.currency === currency)}
                    currency={currency}
                    marketplace={group.marketplace}
                    granularity={granularity}
                    range={definition.range}
                    onSelect={(range, focusedGroup) => {
                      onOpenBreakdown(range, group.marketplace, currency, focusedGroup);
                    }}
                  />
                ))
              : null}
          </div>
        ))}
      </article>
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
