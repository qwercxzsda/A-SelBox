import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import type { InventoryCapture } from "./api/inventory";
import { INVENTORY_OVERDUE_DAYS, inventoryAge, inventoryReportRanges } from "./inventory-coverage";

export function InventoryCoverage({
  captures,
  marketplace,
  now,
}: {
  captures: InventoryCapture[];
  marketplace: string;
  now: number;
}) {
  const reports = inventoryReportRanges(captures, marketplace);
  return (
    <Paper component="section" aria-label="Inventory snapshot coverage" withBorder p="sm">
      <Text size="sm" fw={600}>
        Latest imported reports
      </Text>
      <Text size="xs" c="dimmed">
        Daily snapshots are expected. Source dates older than {INVENTORY_OVERDUE_DAYS} days are
        overdue; processing an older report does not refresh its stock.
      </Text>
      <Group gap="sm" mt="xs" align="start" className="inventory-coverage-markets">
        {reports.map(({ marketplaceName, oldestDay, newestDay }) => {
          const age = inventoryAge(oldestDay, now);
          return (
            <Stack gap={2} key={marketplaceName}>
              <Text size="xs" fw={600}>
                {marketplaceName}
              </Text>
              <Group gap={6}>
                <Text size="xs">
                  Report {oldestDay ?? "date unavailable"}
                  {newestDay && newestDay !== oldestDay ? ` – ${newestDay}` : ""}
                  {oldestDay ? ` · ${age.label}` : ""}
                </Text>
                {age.overdue ? (
                  <Badge size="xs" color="orange" variant="light">
                    Overdue report
                  </Badge>
                ) : null}
              </Group>
            </Stack>
          );
        })}
        {reports.length === 0 ? (
          <Text size="sm">
            {marketplace
              ? `No imported snapshot for ${marketplace}.`
              : "No inventory snapshots imported yet."}
          </Text>
        ) : null}
      </Group>
    </Paper>
  );
}
