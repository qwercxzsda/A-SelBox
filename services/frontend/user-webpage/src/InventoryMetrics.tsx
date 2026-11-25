import { Text } from "@mantine/core";
import type { InventoryRow } from "./api/inventory";
import { formatRecordDate } from "./date-display";
import { formatExactDecimal, formatMoney } from "./decimal";
import type { InventoryMetricDefinition } from "./inventory-metrics";
import { recommendationLabel, recommendationTone, healthTone } from "./inventory-options";
import { MutedValue } from "./StackedValue";
import { StatusBadge, type StatusTone } from "./StatusBadge";

const HEALTH_TONES: Record<ReturnType<typeof healthTone>, StatusTone> = {
  critical: "danger",
  attention: "warning",
  healthy: "success",
  neutral: "neutral",
};

export function InventoryMetrics({
  row,
  fields,
  className,
}: {
  row: InventoryRow;
  fields: readonly InventoryMetricDefinition[];
  className?: string;
}) {
  return (
    <dl className={className}>
      {fields.map(([key, label]) => {
        const rawValue = row[key];
        const value =
          key === "sales_amount_90d"
            ? formatMoney(rawValue, row.currency)
            : key.endsWith("_date") || key.endsWith("_at")
              ? rawValue === null
                ? "—"
                : formatRecordDate(rawValue)
              : formatExactDecimal(rawValue);
        return (
          <div className="inventory-metric" key={key}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A missing status is the plain muted dash used for every missing value, never an empty badge. */
export function InventoryHealthLabel({ status }: { status: string | null }) {
  if (status === null) return <MutedValue />;
  return (
    <StatusBadge tone={HEALTH_TONES[healthTone(status)]} className="inventory-health-label">
      {status}
    </StatusBadge>
  );
}

export function InventoryRecommendationLabel({ action }: { action: string | null }) {
  if (action === null) return <MutedValue />;
  return (
    <Text
      fw={600}
      inherit
      className="inventory-action-label"
      data-tone={recommendationTone(action)}
      title={action}
    >
      {recommendationLabel(action)}
    </Text>
  );
}
