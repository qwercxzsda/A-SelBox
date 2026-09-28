import { useState } from "react";
import { PayoutDetailPage } from "./PayoutDetailPage";
import { Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchPayoutReconciliation } from "./api";
import { formatExactDecimal } from "./decimal";

const AMOUNTS = [
  ["settlement_category_amount", "Settlement category"],
  ["selbox_category_amount", "SelBox category"],
  ["data_kiosk_settlement_control", "Data Kiosk category · Settlement control"],
  ["data_kiosk_category_amount", "Data Kiosk category · Data Kiosk amount"],
  ["difference", "Reconciliation difference"],
  ["settlement_total", "Settlement total"],
  ["accounted_total", "Reconciled total"],
] as const;

/** Administrator-only account controls never contribute again to a company payout. */
export function PayoutReconciliation({
  accessToken,
  reportId,
}: {
  accessToken: string;
  reportId: string;
}) {
  const [opened, setOpened] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const query = useQuery({
    queryKey: ["payout-reconciliation", reportId, pageIndex],
    queryFn: ({ signal }) => fetchPayoutReconciliation(accessToken, reportId, pageIndex, signal),
    enabled: opened,
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <details
      className="audit-details"
      onToggle={(event) => {
        setOpened(event.currentTarget.open);
      }}
    >
      <summary>Seller reconciliation</summary>
      <Text size="sm" my="sm">
        Daily marketplace controls for this seller account. Amounts in the Settlement, SelBox, and
        Data Kiosk categories plus the reconciliation difference equal the Settlement report total.
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        SelBox retains the SelBox category amounts and the difference. These controls are repeated
        across company reports and are not additional company payouts. Do not add them across
        reports.
      </Text>
      <PayoutDetailPage
        query={query}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        label="reconciliation"
        emptyMessage="No saved reconciliation rows."
      >
        {rows.length ? (
          <Table.ScrollContainer minWidth={1250}>
            <Table aria-label="Saved seller reconciliation">
              <Table.Thead>
                <Table.Tr>
                  {["Date", "Marketplace", "Currency", ...AMOUNTS.map(([, label]) => label)].map(
                    (label) => (
                      <Table.Th key={label}>{label}</Table.Th>
                    ),
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.row_number}>
                    <Table.Td>{row.activity_date}</Table.Td>
                    <Table.Td>{row.marketplace_name ?? "Not specified"}</Table.Td>
                    <Table.Td>{row.currency}</Table.Td>
                    {AMOUNTS.map(([key]) => (
                      <Table.Td key={key}>{formatExactDecimal(row[key])}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : null}
      </PayoutDetailPage>
    </details>
  );
}
