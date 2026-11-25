import { Text } from "@mantine/core";
import { INVENTORY_OUT_OF_DATE_RULE, inventoryAge, inventorySourceDay } from "./inventory-coverage";

/** "2026-09-27 · 58 days old · Out of date", the same in the table and the drawer. */
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
  /** The smaller line under a SKU in the table. */
  compact?: boolean;
}) {
  const snapshot = inventorySourceDay(snapshotDate, marketplace);
  const day = snapshot ?? inventorySourceDay(reportCreatedAt, marketplace);
  const age = inventoryAge(day, now, marketplace);
  return (
    <Text
      mt={compact ? 4 : undefined}
      size={compact ? "xs" : "sm"}
      c={age.overdue ? "var(--ui-status-warning-text)" : compact ? "dimmed" : undefined}
      className="inventory-source-date"
      data-compact={compact || undefined}
      title={
        day && !snapshot
          ? `Stock date unavailable; report date shown. ${INVENTORY_OUT_OF_DATE_RULE}`
          : INVENTORY_OUT_OF_DATE_RULE
      }
    >
      {day && !snapshot ? "Report " : ""}
      {day ? <time dateTime={day}>{day}</time> : "Date unavailable"}
      {day ? ` · ${age.label}` : ""}
      {age.overdue ? " · Out of date" : ""}
    </Text>
  );
}
