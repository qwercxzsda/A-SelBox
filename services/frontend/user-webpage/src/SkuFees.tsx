import { Alert, Button, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchSkuFees, type SkuAssignment } from "./api";
import { TableCellValue } from "./Cell";
import type { Identity } from "./auth-session";
import { getErrorMessage, TABLE_COLUMNS } from "./view-model";

export function SkuFees({
  identity,
  assignment,
  companies,
  onRetry,
}: {
  identity: Identity;
  assignment: SkuAssignment;
  companies: Map<string, string>;
  onRetry: () => Promise<void>;
}) {
  const { session, account } = identity;
  const query = useQuery({
    queryKey: [
      "current-fees",
      session.user.id,
      account.access_role,
      account.company_id,
      assignment.id,
      assignment.terms_version_id,
    ],
    queryFn: ({ signal }) => fetchSkuFees(session.access_token, assignment.id, signal),
  });
  if (query.isError) {
    return (
      <Alert color="red" role="alert">
        <Stack gap="sm" align="start">
          <Text size="sm">Could not load marketplace fees. {getErrorMessage(query.error)}</Text>
          <Button
            variant="light"
            color="red"
            loading={query.isFetching}
            onClick={() => void onRetry()}
          >
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (query.isPending) {
    return (
      <Text c="dimmed" size="sm" role="status" py="md">
        Loading marketplace fees…
      </Text>
    );
  }
  const rows = query.data;
  if (rows.length === 0) {
    return <Text c="dimmed">No current marketplace fee periods are available for this SKU.</Text>;
  }
  const columns = TABLE_COLUMNS.fees;
  const widths = [32, 26, 42];

  return (
    <Table
      fz="sm"
      aria-label={`Marketplace fees for ${assignment.sku}`}
      style={{ tableLayout: "fixed", width: "100%" }}
      styles={{
        th: { overflowWrap: "anywhere" },
        td: { overflowWrap: "anywhere", verticalAlign: "top" },
      }}
    >
      <colgroup>
        {columns.map((column, index) => (
          <col key={column.key} style={{ width: `${String(widths[index])}%` }} />
        ))}
      </colgroup>
      <Table.Thead>
        <Table.Tr>
          {columns.map((column) => (
            <Table.Th key={column.key} ta={column.align}>
              {column.label}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.fee_period_id}>
            {columns.map((column) => (
              <Table.Td key={column.key} ta={column.align}>
                <TableCellValue column={column} row={row} companies={companies} />
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
