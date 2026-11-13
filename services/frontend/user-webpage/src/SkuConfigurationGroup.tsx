import { useId } from "react";
import { Badge, Group, Table, Title } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { inspectableRowProps } from "./inspectable-row";
import { FEE_STATUS_LABELS, type FeeStatus } from "./fee-status";
import { formatExactDecimal } from "./decimal";
import { TableDisclosure } from "./TableDisclosure";
import "./MonthGroupedTable.css";

const STATUS_COLORS: Record<FeeStatus, { color: string; c?: string }> = {
  saved: { color: "teal", c: "#065f46" },
  draft: { color: "blue" },
  unfinished: { color: "violet" },
  "needs-setup": { color: "orange", c: "#9a3412" },
};

function FeeStatusLabels({ statuses }: { statuses: readonly FeeStatus[] }) {
  return (
    <Group gap={6}>
      {statuses.map((status) => (
        <Badge key={status} size="xs" variant="light" {...STATUS_COLORS[status]}>
          {FEE_STATUS_LABELS[status]}
        </Badge>
      ))}
    </Group>
  );
}

function FeePeriodCount({
  sku,
  count,
  expanded,
  groupId,
  onToggle,
}: {
  sku: string;
  count: number;
  expanded: boolean;
  groupId: string;
  onToggle: (sku: string) => void;
}) {
  return (
    <div className="fee-period-count">
      <span>
        {count === 0
          ? "No fee periods"
          : `${String(count)} fee ${count === 1 ? "period" : "periods"}`}
      </span>
      {count > 0 ? (
        <TableDisclosure
          expanded={expanded}
          subject="fee periods"
          context={sku}
          controlsId={groupId}
          onToggle={() => {
            onToggle(sku);
          }}
        />
      ) : null}
    </div>
  );
}

/** One row group is one editable SKU, independent of how many fee periods are visible. */
export function SkuConfigurationGroup({
  item,
  companyName,
  marketplaces,
  statuses,
  administrator,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  item: SkuConfigurationItem;
  companyName: string;
  marketplaces: readonly string[];
  statuses: readonly FeeStatus[];
  administrator: boolean;
  selected: boolean;
  expanded: boolean;
  onToggle: (sku: string) => void;
  onSelect: (sku: string) => void;
}) {
  const groupId = useId();
  const periods = [...item.periods].sort(
    (left, right) =>
      left.marketplace_name.localeCompare(right.marketplace_name) ||
      left.valid_from.localeCompare(right.valid_from),
  );
  const visiblePeriods = expanded && periods.length ? periods : [null];
  const marketplaceSummary =
    marketplaces.length === 0
      ? "Not set"
      : marketplaces.length === 1
        ? marketplaces[0]
        : `${String(marketplaces.length)} marketplaces`;
  return (
    <Table.Tbody
      id={groupId}
      className="fee-sku-group"
      data-sku={item.sku}
      data-selected={selected || undefined}
      data-expanded={expanded || undefined}
      aria-label={`Fee configuration for ${item.sku}`}
    >
      {visiblePeriods.map((period, index) => (
        <Table.Tr
          key={index}
          {...inspectableRowProps(selected, () => {
            onSelect(item.sku);
          })}
          className={`inspectable-row${index === 0 ? " fee-sku-summary" : ""}${period ? " fee-period-row" : ""}`}
        >
          {index === 0 ? (
            <>
              <Table.Th
                scope="rowgroup"
                rowSpan={visiblePeriods.length}
                className="month-group-cell fee-sku-group-cell"
              >
                <Title order={3} className="fee-sku-label">
                  {item.sku}
                </Title>
              </Table.Th>
              {administrator ? (
                <Table.Td rowSpan={visiblePeriods.length} className="fee-sku-company">
                  {companyName}
                </Table.Td>
              ) : null}
            </>
          ) : null}
          {index === 0 ? (
            <Table.Td rowSpan={visiblePeriods.length} data-column="period-count">
              <FeePeriodCount
                sku={item.sku}
                count={periods.length}
                expanded={expanded}
                groupId={groupId}
                onToggle={onToggle}
              />
            </Table.Td>
          ) : null}
          <Table.Td data-column="marketplace" title={period ? undefined : marketplaces.join(", ")}>
            {period ? period.marketplace_name || "Not set" : marketplaceSummary}
          </Table.Td>
          {period ? (
            <>
              <Table.Td data-column="fee-rate" className="numeric">
                {period.fee_rate_percent
                  ? `${formatExactDecimal(period.fee_rate_percent)}%`
                  : "Not set"}
              </Table.Td>
              <Table.Td data-column="valid-from">
                {period.valid_from ? (
                  <time dateTime={period.valid_from}>{period.valid_from}</time>
                ) : (
                  "Not set"
                )}
              </Table.Td>
              <Table.Td data-column="valid-to">
                {period.valid_to ? (
                  <time dateTime={period.valid_to}>{period.valid_to}</time>
                ) : (
                  "No end date"
                )}
              </Table.Td>
            </>
          ) : (
            <>
              <Table.Td data-column="fee-rate" className="numeric fee-period-folded">
                —
              </Table.Td>
              <Table.Td data-column="valid-from" className="fee-period-folded">
                —
              </Table.Td>
              <Table.Td data-column="valid-to" className="fee-period-folded">
                —
              </Table.Td>
            </>
          )}
          {index === 0 ? (
            <Table.Td rowSpan={visiblePeriods.length} className="fee-sku-status">
              <FeeStatusLabels statuses={statuses} />
            </Table.Td>
          ) : null}
        </Table.Tr>
      ))}
    </Table.Tbody>
  );
}
