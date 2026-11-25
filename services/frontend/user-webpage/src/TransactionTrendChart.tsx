import { Text } from "@mantine/core";
import { useState } from "react";
import type { AmountTrendPoint } from "./AmountTrendPlot";
import { TRANSACTION_TYPE_GROUPS, type TypeGroupId } from "./transaction-type-families";
import type { DateRange } from "./summary-periods";
import {
  projectTransactionTrend,
  transactionTrendDateLabel,
  transactionTrendPoints,
  transactionTrendShortLabel,
  type TransactionTrendAmount,
  type TransactionTrendGranularity,
} from "./transaction-trend-chart";
import { describeTrendAmounts, trendAmountText } from "./transaction-trend-labels";
import { TransactionTrendInspection } from "./TransactionTrendInspection";
import { TransactionTrendViewport, type TrendRevealRequest } from "./TransactionTrendViewport";
import { MissingFeeRateNote } from "./FinancialAmounts";
import "./TransactionTrendChart.css";

function readPoints(
  rows: readonly TransactionTrendAmount[],
  granularity: TransactionTrendGranularity,
  range: DateRange,
) {
  try {
    return { points: transactionTrendPoints(rows, granularity, range), error: null };
  } catch (error) {
    return {
      points: [],
      error: error instanceof Error ? error.message : "Chart unavailable for this range.",
    };
  }
}

export function TransactionTrendChart({
  rows,
  currency,
  marketplace,
  granularity,
  range,
  onSelect,
}: {
  rows: readonly TransactionTrendAmount[];
  currency: string;
  marketplace: string;
  granularity: TransactionTrendGranularity;
  range: DateRange;
  onSelect: (range: DateRange, groupId?: TypeGroupId) => void;
}) {
  const [inspectedPeriod, setInspectedPeriod] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<TrendRevealRequest | null>(null);
  const { points, error } = readPoints(rows, granularity, range);
  const chart = projectTransactionTrend(points);
  const inspected = points.find((point) => point.periodStart === inspectedPeriod) ?? points.at(-1);
  const periodName = granularity === "day" ? "day" : "week";
  const title = granularity === "day" ? "Daily" : "Weekly";
  const scope = `${marketplace} (${currency})`;
  const missingFeeCount = points.reduce((count, point) => count + point.missingFeeCount, 0);
  const groupLabels = new Map(TRANSACTION_TYPE_GROUPS.map((group) => [group.id, group.label]));
  function navigate(id: string) {
    setInspectedPeriod(id);
    setRevealRequest((current) => ({ id, revision: (current?.revision ?? 0) + 1 }));
  }
  function openPeriod(id: string, groupId?: string) {
    const point = points.find((entry) => entry.periodStart === id);
    const group =
      groupId === undefined
        ? undefined
        : TRANSACTION_TYPE_GROUPS.find((entry) => entry.id === groupId);
    if (point && (groupId === undefined || group))
      onSelect({ from: point.from, to: point.to }, group?.id);
  }
  if (error)
    return (
      <Text size="sm" c="dimmed">
        {error}
      </Text>
    );
  if (!inspected)
    return (
      <Text size="sm" c="dimmed">
        No matching transactions
      </Text>
    );
  const plotted: AmountTrendPoint[] = (chart?.points ?? []).map((point) => ({
    id: point.periodStart,
    shortLabel: transactionTrendShortLabel(point.from),
    accessibleLabel: `Open transaction totals for ${transactionTrendDateLabel(point)} in ${scope}`,
    description: `${transactionTrendDateLabel(point)}: ${describeTrendAmounts(point, currency, point.missingFeeCount)}; ${String(point.rowCount)} transactions`,
    opensDialog: true,
    amountY: null,
    lineY: point.lineY,
    segments: point.segments.map((segment) => {
      const group = point.groups.find((entry) => entry.id === segment.familyId);
      const label = groupLabels.get(segment.familyId) ?? segment.familyId;
      return {
        ...segment,
        description: `${label}: ${describeTrendAmounts(group, currency, segment.missingFeeCount)}. ${segment.part === "serviceFee" ? "Service fee" : "Reported"} contribution: ${trendAmountText(segment.amount, currency, "companyAmount", segment.missingFeeCount)}`,
        actionLabel: `${label}: Open transaction totals for ${transactionTrendDateLabel(point)} in ${scope}, ${segment.part === "serviceFee" ? "service fee" : "reported"} contribution`,
      };
    }),
  }));
  return (
    <figure
      className="transaction-trend-chart"
      aria-label={`${title} company amount trend for ${scope}`}
    >
      <MissingFeeRateNote count={missingFeeCount} mb={6} />
      {chart ? (
        <TransactionTrendViewport
          chart={chart}
          points={plotted}
          currency={currency}
          scope={scope}
          periodName={periodName}
          inspectedId={inspected.periodStart}
          revealRequest={revealRequest}
          onInspect={setInspectedPeriod}
          onNavigate={navigate}
          onSelect={openPeriod}
          onSelectSegment={openPeriod}
        />
      ) : (
        <Text size="sm" c="dimmed">
          Chart unavailable. Exact values are below.
        </Text>
      )}
      {chart?.points.some((point) =>
        point.segments.some((segment) => segment.part === "serviceFee"),
      ) ? (
        <div className="transaction-trend-fee-key">
          <span aria-hidden="true" />
          Service fee
        </div>
      ) : null}
      <TransactionTrendInspection
        points={points}
        inspected={inspected}
        currency={currency}
        scope={scope}
        periodName={periodName}
        colors={new Map(chart?.groups.map((group) => [group.id, group.color]) ?? [])}
        onNavigate={navigate}
        onSelect={onSelect}
      />
    </figure>
  );
}
