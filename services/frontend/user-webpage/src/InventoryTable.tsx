import { Group, Table } from "@mantine/core";
import type { InventoryRow } from "./api/inventory";
import type { InventorySortColumn } from "./inventory-view";
import { ColumnMenu } from "./ColumnMenu";
import { SkuTransactionLink } from "./SkuTransactionLink";
import type { InventoryViewState } from "./workspace-view-state";
import {
  inventoryFilterOptions,
  INVENTORY_HEALTH_VALUES,
  INVENTORY_RECOMMENDATION_VALUES,
} from "./inventory-options";

import { INVENTORY_METRICS } from "./inventory-metrics";
import {
  InventoryMetrics,
  InventoryHealthLabel,
  InventoryRecommendationLabel,
} from "./InventoryMetrics";
import { inventoryRowId } from "./inventory-row";
import { inspectableRowProps } from "./inspectable-row";
import { InventorySourceDate } from "./InventorySourceDate";
import { TableFrame } from "./TableFrame";
import { HelpPopover } from "./HelpPopover";
import type { FilterOption } from "./filter-options";
import { companyLabel } from "./view-model";

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
  skus,
  administrator,
  companyNames,
  companyOptions,
  marketplaceOptions,
  onSelect,
  onShowTransactions,
  now,
}: {
  rows: InventoryRow[];
  viewState: InventoryViewState;
  onChange: (patch: Partial<InventoryViewState>) => void;
  skus: string[];
  administrator: boolean;
  companyNames: Map<string, string>;
  companyOptions: FilterOption[];
  marketplaceOptions: FilterOption[];
  onSelect: (id: string) => void;
  onShowTransactions: (sku: string) => void;
  now: number;
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
    <TableFrame
      label="Inventory items"
      className="inventory-table-card"
      scrollClassName="inventory-scroll"
    >
      <Table
        className="inventory-table"
        data-company-column={administrator || undefined}
        aria-label="Inventory records"
        highlightOnHover
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col" data-column="sku" aria-sort={ariaSort("sku")}>
              <ColumnMenu label="SKU" sort={sort("sku")} filter={selection("skus", skus)} />
            </Table.Th>
            {administrator ? (
              <Table.Th scope="col" data-column="company">
                <ColumnMenu
                  label="Company"
                  filter={{
                    kind: "selection",
                    value: viewState.companyIds.map((id) => JSON.stringify(id)),
                    options: companyOptions,
                    onChange: (values) => {
                      onChange({
                        companyIds: values.map((value) => JSON.parse(value) as string | null),
                      });
                    },
                  }}
                />
              </Table.Th>
            ) : null}
            <Table.Th scope="col" data-column="marketplace">
              <ColumnMenu
                label="Marketplace"
                filter={{
                  kind: "selection",
                  value: viewState.marketplaces,
                  options: marketplaceOptions,
                  onChange: (marketplaces) => {
                    onChange({ marketplaces });
                  },
                }}
              />
            </Table.Th>
            <Table.Th scope="col" aria-sort={ariaSort("sales_amount_90d")}>
              <Group gap={4} wrap="nowrap">
                <ColumnMenu label="Sales · last 90 days" sort={sort("sales_amount_90d")} />
                <HelpPopover label="Sales amount help">
                  <p>
                    Sales use original currencies without conversion. Select one marketplace before
                    comparing amounts.
                  </p>
                </HelpPopover>
              </Group>
            </Table.Th>
            <Table.Th scope="col">Inventory overview</Table.Th>
            <Table.Th scope="col" aria-sort={ariaSort("health_status")}>
              <ColumnMenu
                label="Inventory health status"
                sort={sort("health_status")}
                filter={selection("healthStatuses", INVENTORY_HEALTH_VALUES)}
              />
            </Table.Th>
            <Table.Th scope="col" aria-sort={ariaSort("recommended_action")}>
              <ColumnMenu
                label="Recommendation"
                sort={sort("recommended_action")}
                filter={selection("recommendations", INVENTORY_RECOMMENDATION_VALUES)}
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
              <Table.Td data-column="sku">
                <SkuTransactionLink
                  className="inventory-sku"
                  sku={row.sku}
                  onShowTransactions={onShowTransactions}
                />
                <InventorySourceDate
                  snapshotDate={row.snapshot_date}
                  reportCreatedAt={row.report_created_at}
                  marketplace={row.marketplace_name}
                  now={now}
                  compact
                />
              </Table.Td>
              {administrator ? (
                <Table.Td data-column="company">
                  {companyLabel(row.company_id, companyNames)}
                </Table.Td>
              ) : null}
              <Table.Td data-column="marketplace">{row.marketplace_name}</Table.Td>
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
    </TableFrame>
  );
}
