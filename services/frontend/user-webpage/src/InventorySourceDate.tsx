import { Text } from "@mantine/core";
import { INVENTORY_OVERDUE_DAYS, inventoryAge, inventorySourceDay } from "./inventory-coverage";

export function InventorySourceDate({
  snapshotDate,
  reportCreatedAt,
  marketplace,
  now,
  compact = false,
}: {
  snapshotDate: string | null;
  reportCreatedAt: string;
  marketplace: string;
  now: number;
  compact?: boolean;
}) {
  const snapshot = inventorySourceDay(snapshotDate, marketplace);
  const day = snapshot ?? inventorySourceDay(reportCreatedAt, marketplace);
  const age = inventoryAge(day, now, marketplace);
  return (
    <Text
      mt={4}
      size={compact ? "xs" : "sm"}
      c={age.overdue ? "#8a5000" : "dimmed"}
      className="inventory-source-date"
      title={`Dates more than ${String(INVENTORY_OVERDUE_DAYS)} calendar days old in this marketplace are out of date.`}
    >
      {snapshot ? "Stock as of " : "Stock date unavailable · Report "}
      {day ? <time dateTime={day}>{day}</time> : "date unavailable"}
      {day ? ` · ${age.label}` : ""}
      {age.overdue ? " · Out of date" : ""}
    </Text>
  );
}
