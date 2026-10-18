import { Badge, Group, Text } from "@mantine/core";
import { inventoryAge, inventorySourceDay } from "./inventory-coverage";

export function InventorySourceDate({
  snapshotDate,
  reportCreatedAt,
  now,
  compact = false,
}: {
  snapshotDate: string | null;
  reportCreatedAt: string;
  now: number;
  compact?: boolean;
}) {
  const snapshot = inventorySourceDay(snapshotDate);
  const day = snapshot ?? inventorySourceDay(reportCreatedAt);
  const age = inventoryAge(day, now);
  return (
    <Group gap={6} mt={4} className="inventory-source-date">
      <Text size={compact ? "xs" : "sm"} c="dimmed">
        {snapshot
          ? `Stock as of ${snapshot}`
          : `Stock date unavailable · Report ${day ?? "date unavailable"}`}
        {day ? ` · ${age.label}` : ""}
      </Text>
      {age.overdue ? (
        <Badge size="xs" color="orange" variant="light">
          Overdue snapshot
        </Badge>
      ) : null}
    </Group>
  );
}
