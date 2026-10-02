import { Text } from "@mantine/core";
import type { InventoryRow } from "./api/inventory";
import { formatRecordDate } from "./date-display";
import { formatExactDecimal, formatExactMoney } from "./decimal";
import type { InventoryMetricDefinition } from "./inventory-metrics";
import { recommendationLabel, recommendationTone } from "./inventory-options";

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
            ? formatExactMoney(rawValue, row.currency)
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

export function InventoryHealthLabel({ status }: { status: string | null }) {
  return (
    <Text fw={600} inherit className="inventory-health-label" data-status={status?.toLowerCase()}>
      {status ?? "—"}
    </Text>
  );
}

export function InventoryRecommendationLabel({ action }: { action: string | null }) {
  return (
    <Text
      fw={600}
      inherit
      className="inventory-action-label"
      data-tone={recommendationTone(action)}
    >
      {action === null ? "—" : recommendationLabel(action)}
    </Text>
  );
}
