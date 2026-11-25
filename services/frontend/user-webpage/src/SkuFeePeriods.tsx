import { Table, Text } from "@mantine/core";
import type { SkuConfigurationItem, SkuConfigurationPeriod } from "./api";
import { feeRateLabel } from "./fee-rate-summary";
import { FEE_PERIOD_FROM_LABEL, FEE_PERIOD_UNTIL_LABEL, NO_END_DATE } from "./fee-period-labels";
import { TableColumnLabel } from "./TableColumnLabel";
import "./SkuConfigurationList.css";
import "./DetailTable.css";

function PeriodDate({ value, empty }: { value: string | null; empty: string }) {
  return value ? <time dateTime={value}>{value}</time> : empty;
}

/** The two date headings of every fee period table. */
export function FeePeriodDateHeaders() {
  return (
    <>
      <Table.Th scope="col">
        <TableColumnLabel label={FEE_PERIOD_FROM_LABEL} />
      </Table.Th>
      <Table.Th scope="col">
        <TableColumnLabel label={FEE_PERIOD_UNTIL_LABEL} />
      </Table.Th>
    </>
  );
}

/** A period's start ("Not set" until chosen) and end ("No end date" while the rate is ongoing). */
export function FeePeriodDateCells({
  period,
}: {
  period: Pick<SkuConfigurationPeriod, "valid_from" | "valid_to">;
}) {
  return (
    <>
      <Table.Td data-column="valid-from">
        <PeriodDate value={period.valid_from} empty="Not set" />
      </Table.Td>
      <Table.Td data-column="valid-to">
        <PeriodDate value={period.valid_to} empty={NO_END_DATE} />
      </Table.Td>
    </>
  );
}

export function SkuFeePeriods({
  item,
  label = `Marketplace fees for ${item.sku}`,
}: {
  item: Pick<SkuConfigurationItem, "sku" | "periods">;
  label?: string;
}) {
  if (item.periods.length === 0) return <Text c="dimmed">No fee periods</Text>;
  return (
    <div
      className="detail-table-scroll"
      role="region"
      aria-label={`${label} table`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Fee periods can be scrolled with the keyboard on narrow screens.
      tabIndex={0}
    >
      <Table className="detail-table fee-period-table" aria-label={label}>
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Marketplace</Table.Th>
            <Table.Th scope="col" ta="right">
              Fee rate
            </Table.Th>
            <FeePeriodDateHeaders />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {item.periods.map((period, index) => (
            <Table.Tr key={index}>
              <Table.Td data-column="marketplace">{period.marketplace_name || "Not set"}</Table.Td>
              <Table.Td data-column="fee-rate" ta="right">
                {feeRateLabel(period.fee_rate_percent)}
              </Table.Td>
              <FeePeriodDateCells period={period} />
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
