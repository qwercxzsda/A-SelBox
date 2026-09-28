import { Table, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { formatExactDecimal } from "./decimal";

export function SkuFeePeriods({ item }: { item: Pick<SkuConfigurationItem, "sku" | "periods"> }) {
  if (item.periods.length === 0)
    return <Text c="dimmed">No current marketplace fee periods are available for this SKU.</Text>;
  return (
    <Table
      fz="sm"
      aria-label={`Marketplace fees for ${item.sku}`}
      style={{ tableLayout: "fixed", width: "100%" }}
      styles={{
        th: { overflowWrap: "anywhere" },
        td: { overflowWrap: "anywhere", verticalAlign: "top" },
      }}
    >
      <colgroup>
        <col style={{ width: "32%" }} />
        <col style={{ width: "26%" }} />
        <col style={{ width: "42%" }} />
      </colgroup>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Marketplace</Table.Th>
          <Table.Th ta="right">Fee rate</Table.Th>
          <Table.Th>Effective dates</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {item.periods.map((period, index) => (
          <Table.Tr key={index}>
            <Table.Td>{period.marketplace_name || "Not set"}</Table.Td>
            <Table.Td ta="right">
              {period.fee_rate_percent
                ? `${formatExactDecimal(period.fee_rate_percent)}%`
                : "Not set"}
            </Table.Td>
            <Table.Td>
              <span style={{ whiteSpace: "nowrap" }}>{period.valid_from || "Not set"}</span>
              {" → "}
              {period.valid_to ? (
                <>
                  Before <span style={{ whiteSpace: "nowrap" }}>{period.valid_to}</span>
                </>
              ) : (
                <span style={{ whiteSpace: "nowrap" }}>No end date</span>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
