import { Table, Text } from "@mantine/core";
import type { InventoryRow } from "./api/inventory";
import { formatExactDecimal, formatExactMoney } from "./decimal";

const RECOMMENDATION_LABELS = new Map([
  ["SendToFBA", "Send to FBA"],
  ["GoToRestock", "Restock"],
]);

type MetricDefinition = readonly [keyof InventoryRow, string];

const METRICS = {
  sales: [
    ["sales_amount_90d", "Sales"],
    ["units_shipped_90d", "Units shipped"],
  ],
  overview: [
    ["available_quantity", "Available"],
    ["fba_supply_quantity", "Supply at FBA"],
    ["inbound_quantity", "Inbound"],
    ["reserved_quantity", "Reserved"],
    ["unfulfillable_quantity", "Unfulfillable"],
  ],
  breakdown: [
    ["inbound_working_quantity", "Inbound working"],
    ["inbound_shipped_quantity", "Inbound shipped"],
    ["inbound_received_quantity", "Inbound received"],
    ["reserved_transfer_quantity", "Reserved transfer"],
    ["reserved_processing_quantity", "Reserved processing"],
    ["reserved_customer_order_quantity", "Reserved customer orders"],
  ],
  health: [
    ["minimum_inventory_units", "Minimum inventory (units)"],
    ["days_of_supply", "Days of supply"],
    ["total_days_of_supply", "Total days of supply"],
  ],
  recommendation: [
    ["recommended_ship_in_units", "Recommended ship-in units"],
    ["recommended_ship_in_date", "Recommended ship-in date"],
  ],
} as const satisfies Record<string, readonly MetricDefinition[]>;

function Metrics({ row, fields }: { row: InventoryRow; fields: readonly MetricDefinition[] }) {
  return (
    <dl>
      {fields.map(([key, label]) => {
        const value =
          key === "sales_amount_90d"
            ? formatExactMoney(row[key], row.currency)
            : key === "recommended_ship_in_date"
              ? row[key]
              : formatExactDecimal(row[key]);
        return (
          <div className="inventory-metric" key={key}>
            <dt>{label}</dt>
            <dd>{value ?? "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  return (
    <>
      <Text size="sm" c="dimmed" className="inventory-scroll-hint" id="inventory-scroll-hint">
        Scroll horizontally to see all columns. You can focus the table and use the arrow keys.
      </Text>
      <div
        className="inventory-scroll"
        role="region"
        aria-label="Inventory items"
        aria-describedby="inventory-scroll-hint"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
        tabIndex={0}
      >
        <Table className="inventory-table" striped withTableBorder>
          <Table.Caption>
            Latest daily capture for each seller and marketplace. Quantities are reported estimates.
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">SKU</Table.Th>
              <Table.Th scope="col">Sales · last 90 days</Table.Th>
              <Table.Th scope="col">Inventory overview</Table.Th>
              <Table.Th scope="col">Inventory health status</Table.Th>
              <Table.Th scope="col">Recommendation</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={JSON.stringify([row.capture_id, row.sku])}>
                <Table.Td>
                  <Text fw={600} className="inventory-sku">
                    {row.sku}
                  </Text>
                  <Text size="sm">{row.marketplace_name}</Text>
                  <div className="inventory-dates">
                    <Text size="xs">Capture: {row.capture_date}</Text>
                    <Text size="xs">Snapshot: {row.snapshot_date ?? "—"}</Text>
                    <Text size="xs">Report: {timestamp(row.report_created_at)}</Text>
                    <Text size="xs">Processed: {timestamp(row.preprocessed_at)}</Text>
                  </div>
                </Table.Td>
                <Table.Td>
                  <Metrics row={row} fields={METRICS.sales} />
                </Table.Td>
                <Table.Td>
                  <Metrics row={row} fields={METRICS.overview} />
                  <details>
                    <summary>Inventory breakdown</summary>
                    <Metrics row={row} fields={METRICS.breakdown} />
                  </details>
                </Table.Td>
                <Table.Td>
                  <Text
                    fw={600}
                    className="inventory-health-label"
                    data-status={row.health_status?.toLowerCase()}
                  >
                    {row.health_status ?? "—"}
                  </Text>
                  <Metrics row={row} fields={METRICS.health} />
                </Table.Td>
                <Table.Td>
                  <Text fw={600} className="inventory-action-label">
                    {RECOMMENDATION_LABELS.get(row.recommended_action ?? "") ??
                      row.recommended_action ??
                      "—"}
                  </Text>
                  <Metrics row={row} fields={METRICS.recommendation} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </>
  );
}
