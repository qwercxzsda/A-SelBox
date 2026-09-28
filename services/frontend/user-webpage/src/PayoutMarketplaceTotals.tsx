import { Alert, Button, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchPayoutMarketplaceTotals } from "./api";
import { formatExactDecimal } from "./decimal";

export function PayoutMarketplaceTotals({
  accessToken,
  reportId,
  currency,
}: {
  accessToken: string;
  reportId: string;
  currency: string;
}) {
  const query = useQuery({
    queryKey: ["payout-marketplace-totals", reportId],
    queryFn: ({ signal }) => fetchPayoutMarketplaceTotals(accessToken, reportId, signal),
    staleTime: Infinity,
  });
  const rows = query.data ?? [];
  return (
    <section aria-label="Marketplace breakdown">
      <Title order={4} mt="lg" mb="sm">
        Marketplace breakdown
      </Title>
      {query.isPending ? <Text role="status">Loading marketplace breakdown…</Text> : null}
      {query.isError ? (
        <Alert role="alert" color="red">
          Could not load marketplace breakdown.
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry marketplace breakdown
          </Button>
        </Alert>
      ) : null}
      {query.isSuccess && rows.length === 0 ? <Text>No saved marketplace amounts.</Text> : null}
      {rows.length ? (
        <Table.ScrollContainer minWidth={340}>
          <Table aria-label="Payout marketplace breakdown">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marketplace</Table.Th>
                <Table.Th>Reported ({currency})</Table.Th>
                <Table.Th>Service fee ({currency})</Table.Th>
                <Table.Th>Company ({currency})</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.marketplace_name ?? "unspecified"}>
                  <Table.Td>{row.marketplace_name ?? "Not specified"}</Table.Td>
                  <Table.Td>{formatExactDecimal(row.source_amount)}</Table.Td>
                  <Table.Td>{formatExactDecimal(row.fee_amount)}</Table.Td>
                  <Table.Td>{formatExactDecimal(row.company_amount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}
    </section>
  );
}
