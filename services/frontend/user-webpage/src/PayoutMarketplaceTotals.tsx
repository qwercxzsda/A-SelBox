import { useQuery } from "@tanstack/react-query";
import { fetchPayoutMarketplaceTotals } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { financialAmountColumns } from "./detail-columns";

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
    <DetailData
      query={query}
      label="marketplace breakdown"
      rowCount={rows.length}
      emptyMessage="No saved marketplace amounts."
    >
      {rows.length > 0 ? (
        <DetailTable
          label="Payout marketplace breakdown"
          columns={[
            { key: "marketplace_name", label: "Marketplace", empty: "Not specified", nowrap: true },
            ...financialAmountColumns(currency),
          ]}
          rows={rows}
          rowKey={(row) => row.marketplace_name ?? "unspecified"}
          minWidth={600}
        />
      ) : null}
    </DetailData>
  );
}
