import { Table, Text } from "@mantine/core";
import type { InventoryFilterOptions, InventoryRow, InventorySortColumn } from "./api/inventory";
import { ColumnMenu } from "./ColumnMenu";
import { SkuTransactionLink } from "./SkuTransactionLink";
import type { InventoryViewState } from "./workspace-view-state";
import { inventoryFilterOptions } from "./inventory-options";

import { INVENTORY_METRICS } from "./inventory-metrics";
import {
  InventoryMetrics,
  InventoryHealthLabel,
  InventoryRecommendationLabel,
} from "./InventoryMetrics";
import { inventoryRowId } from "./inventory-row";
import { inspectableRowProps } from "./inspectable-row";

const OVERVIEW = INVENTORY_METRICS.overview.filter(
  ([key]) => key === "available_quantity" || key === "inbound_quantity",
);
const HEALTH = INVENTORY_METRICS.health.filter(([key]) => key === "days_of_supply");
const RECOMMENDATION = INVENTORY_METRICS.recommendation.filter(
  ([key]) => key === "recommended_ship_in_units",
);

export function InventoryTable({
  rows,
  viewState,
  onChange,
  filterOptions,
  onSelect,
  onShowTransactions,
}: {
  rows: InventoryRow[];
  viewState: InventoryViewState;
  onChange: (patch: Partial<InventoryViewState>) => void;
  filterOptions?: InventoryFilterOptions;
  onSelect: (id: string) => void;
  onShowTransactions: (sku: string) => void;
}) {
  const sort = (column: InventorySortColumn) => ({
    direction: viewState.sortColumn === column ? viewState.sortDirection : (false as const),
    onChange: (sortDirection: "asc" | "desc") => {
      onChange({ sortColumn: column, sortDirection });
    },
    ascendingLabel:
      column === "sku"
        ? "A to Z"
        : column === "sales_amount_90d"
          ? "Lowest first"
          : "Least urgent first",
    descendingLabel:
      column === "sku"
        ? "Z to A"
        : column === "sales_amount_90d"
          ? "Highest first"
          : "Most urgent first",
  });
  const selection = (
    field: "skus" | "healthStatuses" | "recommendations",
    values: (string | null)[],
  ) => ({
    kind: "selection" as const,
    value: viewState[field].map((value) => JSON.stringify(value)),
    options: inventoryFilterOptions(
      values,
      viewState[field],
      field === "recommendations"
        ? "recommended_action"
        : field === "healthStatuses"
          ? "health_status"
          : "sku",
    ),
    onChange: (values: string[]) => {
      onChange({ [field]: values.map((value) => JSON.parse(value) as string | null) });
    },
  });
  const ariaSort = (column: InventorySortColumn) =>
    viewState.sortColumn === column
      ? viewState.sortDirection === "asc"
        ? "ascending"
        : "descending"
      : undefined;
  return (
    <>
      <Text size="xs" c="dimmed">
        Select a row for inventory details. Select a SKU to view its transactions.
      </Text>
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
        <Table className="inventory-table" highlightOnHover>
          <Table.Caption>
            Latest daily capture for each seller and marketplace. Quantities are reported estimates.
            Sales ordering compares reported amounts without currency conversion; unavailable values
            appear last. Health and recommendations sort by urgency, with unknown values last.
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col" aria-sort={ariaSort("sku")}>
                <ColumnMenu
                  label="SKU"
                  sort={sort("sku")}
                  filter={selection("skus", filterOptions?.skus ?? [])}
                />
              </Table.Th>
              <Table.Th scope="col" aria-sort={ariaSort("sales_amount_90d")}>
                <ColumnMenu label="Sales · last 90 days" sort={sort("sales_amount_90d")} />
              </Table.Th>
              <Table.Th scope="col">Inventory overview</Table.Th>
              <Table.Th scope="col" aria-sort={ariaSort("health_status")}>
                <ColumnMenu
                  label="Inventory health status"
                  sort={sort("health_status")}
                  filter={selection("healthStatuses", filterOptions?.health_statuses ?? [])}
                />
              </Table.Th>
              <Table.Th scope="col" aria-sort={ariaSort("recommended_action")}>
                <ColumnMenu
                  label="Recommendation"
                  sort={sort("recommended_action")}
                  filter={selection("recommendations", filterOptions?.recommendations ?? [])}
                />
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr
                key={inventoryRowId(row)}
                {...inspectableRowProps(viewState.selectedRowId === inventoryRowId(row), () => {
                  onSelect(inventoryRowId(row));
                })}
              >
                <Table.Td>
                  <SkuTransactionLink
                    className="inventory-sku"
                    sku={row.sku}
                    onShowTransactions={onShowTransactions}
                  />
                  <Text inherit>{row.marketplace_name}</Text>
                </Table.Td>
                <Table.Td>
                  <InventoryMetrics row={row} fields={INVENTORY_METRICS.sales} />
                </Table.Td>
                <Table.Td>
                  <InventoryMetrics row={row} fields={OVERVIEW} />
                </Table.Td>
                <Table.Td>
                  <InventoryHealthLabel status={row.health_status} />
                  <InventoryMetrics row={row} fields={HEALTH} />
                </Table.Td>
                <Table.Td>
                  <InventoryRecommendationLabel action={row.recommended_action} />
                  <InventoryMetrics row={row} fields={RECOMMENDATION} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </>
  );
}
