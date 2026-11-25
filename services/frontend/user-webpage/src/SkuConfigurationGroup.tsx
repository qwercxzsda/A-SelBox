import { useId } from "react";
import { Group, Table, Title } from "@mantine/core";
import { StatusBadge } from "./StatusBadge";
import type { SkuConfigurationItem, SkuConfigurationPeriod } from "./api";
import { inspectableRowProps } from "./inspectable-row";
import { FEE_STATUS_LABELS, FEE_STATUS_TONES, type FeeStatus } from "./fee-status";
import { FeePeriodDateCells } from "./SkuFeePeriods";
import { TableDisclosure } from "./TableDisclosure";
import { currentFeePeriods, feeRateLabel, utcToday } from "./fee-rate-summary";
import "./GroupedTable.css";

function FeeStatusLabels({ statuses }: { statuses: readonly FeeStatus[] }) {
  return (
    <Group gap={6}>
      {statuses.map((status) => (
        <StatusBadge key={status} tone={FEE_STATUS_TONES[status]}>
          {FEE_STATUS_LABELS[status]}
        </StatusBadge>
      ))}
    </Group>
  );
}

function FeePeriodCells({ period }: { period: SkuConfigurationPeriod }) {
  return (
    <>
      <Table.Td data-column="fee-rate" className="numeric">
        {feeRateLabel(period.fee_rate_percent)}
      </Table.Td>
      <FeePeriodDateCells period={period} />
    </>
  );
}

/** A collapsed SKU shows its one current rate, or how many rates apply today. */
function CurrentRateCells({ periods }: { periods: readonly SkuConfigurationPeriod[] }) {
  const current = currentFeePeriods(periods, utcToday());
  if (current.length === 1) return <FeePeriodCells period={current[0]} />;
  return (
    <>
      <Table.Td data-column="fee-rate" className="numeric fee-period-folded">
        {periods.length === 0
          ? "—"
          : current.length === 0
            ? "No current rate"
            : `${String(current.length)} rates`}
      </Table.Td>
      <Table.Td data-column="valid-from" className="fee-period-folded" />
      <Table.Td data-column="valid-to" className="fee-period-folded" />
    </>
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
                className="group-header-cell fee-sku-group-cell"
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
          {period ? <FeePeriodCells period={period} /> : <CurrentRateCells periods={periods} />}
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
