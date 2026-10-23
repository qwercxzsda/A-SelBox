import type { ReactNode } from "react";
import { Table, Text, Title } from "@mantine/core";
import { formatRecordMonth } from "./date-display";
import "./MonthGroupedTable.css";

/** Month heading shared by the saved reports in one table group. */
export function MonthGroupCell({
  month,
  rowSpan,
  description,
}: {
  month: string;
  rowSpan: number;
  description: ReactNode;
}) {
  return (
    <Table.Th scope="rowgroup" rowSpan={rowSpan} className="month-group-cell">
      <Title order={3}>
        <time dateTime={month.slice(0, 7)}>{formatRecordMonth(month)}</time>
      </Title>
      <Text size="xs" c="dimmed" mt={4}>
        {description}
      </Text>
    </Table.Th>
  );
}
