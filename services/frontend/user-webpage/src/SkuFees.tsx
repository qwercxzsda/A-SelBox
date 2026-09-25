import { Alert, Button, Stack, Table, Text } from "@mantine/core";
import { useQueries } from "@tanstack/react-query";
import { fetchSkuFees, type CanonicalRow } from "./api";
import { TableCellValue } from "./Cell";
import type { FeeSkuGroup } from "./fee-sku-groups";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage, TABLE_COLUMNS } from "./view-model";

function compareFeeRows(
  left: CanonicalRow,
  right: CanonicalRow,
  companies: Map<string, string>,
): number {
  const companyOrder = companyLabel(left.company_id, companies).localeCompare(
    companyLabel(right.company_id, companies),
  );
  if (companyOrder !== 0) return companyOrder;
  for (const field of ["marketplace_name", "valid_period", "seller_sku_id", "fee_period_id"]) {
    const order = (left[field] ?? "").localeCompare(right[field] ?? "");
    if (order !== 0) return order;
  }
  return 0;
}

export function SkuFees({
  identity,
  group,
  companies,
  onRetry,
}: {
  identity: Identity;
  group: FeeSkuGroup;
  companies: Map<string, string>;
  onRetry: () => Promise<void>;
}) {
  const { session, account } = identity;
  const queries = useQueries({
    queries: group.assignments.map((assignment) => ({
      queryKey: [
        "current-fees",
        session.user.id,
        account.access_role,
        account.company_id,
        assignment.id,
        assignment.terms_version_id,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchSkuFees(session.access_token, assignment.id, signal),
    })),
  });
  const failed = queries.find((query) => query.isError);
  if (failed) {
    return (
      <Alert color="red" role="alert">
        <Stack gap="sm" align="start">
          <Text size="sm">
            Could not load all marketplace fees. {getErrorMessage(failed.error)}
          </Text>
          <Button
            variant="light"
            color="red"
            loading={queries.some((query) => query.isFetching)}
            onClick={() => void onRetry()}
          >
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (queries.some((query) => query.isPending)) {
    return (
      <Text c="dimmed" size="sm" role="status" py="md">
        Loading marketplace fees…
      </Text>
    );
  }
  const rows = queries
    .flatMap((query) => query.data ?? [])
    .sort((left, right) => compareFeeRows(left, right, companies));
  if (rows.length === 0) {
    return <Text c="dimmed">No current marketplace fee periods are available for this SKU.</Text>;
  }
  const showCompany =
    account.access_role === "operator" &&
    new Set(group.assignments.map((assignment) => assignment.company_id)).size > 1;
  const columns = [
    ...(showCompany ? ["company_id"] : []),
    "marketplace_name",
    "fee_rate_percent",
    "valid_period",
  ].flatMap((key) => TABLE_COLUMNS.fees.filter((column) => column.key === key));
  const widths = showCompany ? [20, 25, 26, 29] : [32, 26, 42];

  return (
    <Table
      fz="sm"
      aria-label={`Marketplace fees for ${group.sku}`}
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
          <Table.Tr key={JSON.stringify([row.seller_sku_id, row.fee_period_id])}>
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
