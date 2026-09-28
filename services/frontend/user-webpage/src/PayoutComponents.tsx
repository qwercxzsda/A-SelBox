import { useState } from "react";
import { PayoutDetailPage } from "./PayoutDetailPage";
import { Table, Tabs, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchPayoutComponents } from "./api";
import { humanizeCode, transactionTypeLabel } from "./categories";
import { formatExactDecimal } from "./decimal";

export function PayoutComponents({
  accessToken,
  reportId,
  currency,
}: {
  accessToken: string;
  reportId: string;
  currency: string;
}) {
  const [authoritative, setAuthoritative] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const query = useQuery({
    queryKey: ["payout-components", reportId, authoritative, pageIndex],
    queryFn: ({ signal }) =>
      fetchPayoutComponents(accessToken, reportId, authoritative, pageIndex, signal),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <section aria-label="Payout components">
      <Title order={4} mt="lg" mb="sm">
        Report details
      </Title>
      <Tabs
        value={authoritative ? "amounts" : "context"}
        onChange={(value) => {
          setAuthoritative(value === "amounts");
          setPageIndex(0);
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="amounts">Payout amounts</Tabs.Tab>
          <Tabs.Tab value="context">Supporting details</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Text size="sm" c="dimmed" my="sm">
        {authoritative
          ? "Amounts in the Settlement and Data Kiosk categories contribute to this company’s payout."
          : "Comparison and analysis details are excluded from the payout total."}
      </Text>
      <PayoutDetailPage
        query={query}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        label="details"
        emptyMessage="No saved details for this section."
      >
        {rows.length ? (
          <Table.ScrollContainer minWidth={680}>
            <Table
              aria-label={authoritative ? "Company payout components" : "Supporting payout details"}
            >
              <Table.Thead>
                <Table.Tr>
                  {[
                    "Date",
                    "SKU",
                    "Source",
                    "Marketplace",
                    "Type",
                    "Quantity",
                    `Reported (${currency})`,
                    ...(authoritative
                      ? [`Service fee (${currency})`, `Company (${currency})`]
                      : []),
                  ].map((label) => (
                    <Table.Th key={label}>{label}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td>{row.activity_date}</Table.Td>
                    <Table.Td>{row.sku}</Table.Td>
                    <Table.Td>{humanizeCode(row.source ?? "")}</Table.Td>
                    <Table.Td>{row.marketplace_name ?? "—"}</Table.Td>
                    <Table.Td>{transactionTypeLabel(row.component_type ?? "")}</Table.Td>
                    <Table.Td>{row.quantity ?? "—"}</Table.Td>
                    <Table.Td>{formatExactDecimal(row.source_amount)}</Table.Td>
                    {authoritative ? (
                      <>
                        <Table.Td>{formatExactDecimal(row.fee_amount)}</Table.Td>
                        <Table.Td>{formatExactDecimal(row.company_amount)}</Table.Td>
                      </>
                    ) : null}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : null}
      </PayoutDetailPage>
    </section>
  );
}
