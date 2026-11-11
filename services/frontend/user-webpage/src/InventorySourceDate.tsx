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
  const sourceLabel = snapshot ? "Stock as of " : "Stock date unavailable · Report ";
  const warning = age.overdue ? " · Out of date" : "";
  const description = `${sourceLabel}${day ?? "date unavailable"}${day ? ` · ${age.label}` : ""}${warning}`;
  const ageLabel = compact ? age.compactLabel : age.label;
  return (
    <Text
      mt={4}
      size={compact ? "xs" : "sm"}
      c={age.overdue ? "#8a5000" : "dimmed"}
      className="inventory-source-date"
      data-compact={compact || undefined}
      title={`${description}. Dates more than ${String(INVENTORY_OVERDUE_DAYS)} calendar days old in this marketplace are out of date.`}
    >
      {compact ? (day && !snapshot ? "Report " : "") : sourceLabel}
      {day ? <time dateTime={day}>{day}</time> : compact ? "Date unavailable" : "date unavailable"}
      {day ? ` · ${ageLabel}` : ""}
      {warning}
    </Text>
  );
}
