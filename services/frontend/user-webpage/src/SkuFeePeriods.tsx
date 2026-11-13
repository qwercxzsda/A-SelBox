import { Table, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { formatExactDecimal } from "./decimal";
import "./SkuConfigurationList.css";
import "./DetailTable.css";

export function SkuFeePeriods({
  item,
  label = `Marketplace fees for ${item.sku}`,
}: {
  item: Pick<SkuConfigurationItem, "sku" | "periods">;
  label?: string;
}) {
  if (item.periods.length === 0)
    return <Text c="dimmed">No marketplace fee periods are available for this SKU.</Text>;
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
          <col style={{ width: "32%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "42%" }} />
        </colgroup>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Marketplace</Table.Th>
            <Table.Th scope="col" ta="right">
              Fee rate
            </Table.Th>
            <Table.Th scope="col">Effective dates</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {item.periods.map((period, index) => (
            <Table.Tr key={index}>
              <Table.Td className="fee-period-marketplace">
                {period.marketplace_name || "Not set"}
              </Table.Td>
              <Table.Td ta="right" className="fee-period-rate">
                {period.fee_rate_percent
                  ? `${formatExactDecimal(period.fee_rate_percent)}%`
                  : "Not set"}
              </Table.Td>
              <Table.Td>
                <span className="fee-period-date">{period.valid_from || "Not set"}</span>
                {" → "}
                {period.valid_to ? (
                  <>
                    <span className="fee-period-date">{period.valid_to}</span> (exclusive)
                  </>
                ) : (
                  <span className="fee-period-date">No end date</span>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
