import { Button, NativeSelect } from "@mantine/core";
import {
  compactTransactionTrendDateLabel,
  transactionTrendDateLabel,
  type TransactionTrendPoint,
} from "./transaction-trend-chart";

export function TransactionTrendNavigation({
  points,
  inspected,
  scope,
  periodName,
  onNavigate,
  onOpen,
}: {
  points: readonly TransactionTrendPoint[];
  inspected: TransactionTrendPoint;
  scope: string;
  periodName: "day" | "week";
  onNavigate: (id: string) => void;
  onOpen: () => void;
}) {
  const index = points.findIndex((point) => point.periodStart === inspected.periodStart);
  const fullDate = transactionTrendDateLabel(inspected);
  return (
    <div className="transaction-trend-detail-controls">
      <div
        className="transaction-trend-period-controls"
        role="group"
        aria-label={`Select chart ${periodName} for ${scope}`}
      >
        <Button
          variant="default"
          size="sm"
          aria-label={`Previous ${periodName} for ${scope}`}
          aria-disabled={index === 0}
          data-disabled={index === 0 || undefined}
          tabIndex={index === 0 ? -1 : undefined}
          onClick={() => {
            if (index > 0) onNavigate(points[index - 1].periodStart);
          }}
        >
          Previous
        </Button>
        <NativeSelect
          label={`Chart ${periodName}`}
          aria-label={`Chart ${periodName} for ${scope}`}
          title={fullDate}
          value={inspected.periodStart}
          onChange={(event) => {
            onNavigate(event.currentTarget.value);
          }}
          data={points.map((point) => ({
            value: point.periodStart,
            label: compactTransactionTrendDateLabel(point),
          }))}
        />
        <Button
          variant="default"
          size="sm"
          aria-label={`Next ${periodName} for ${scope}`}
          aria-disabled={index === points.length - 1}
          data-disabled={index === points.length - 1 || undefined}
          tabIndex={index === points.length - 1 ? -1 : undefined}
          onClick={() => {
            if (index < points.length - 1) onNavigate(points[index + 1].periodStart);
          }}
        >
          Next
        </Button>
      </div>
      <Button
        variant="light"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`Open ${periodName} details for ${scope}`}
        onClick={onOpen}
      >
        Open {periodName} details
      </Button>
    </div>
  );
}
