import { useQuery } from "@tanstack/react-query";
import { fetchPayoutTypeTotals, type CanonicalRow } from "./api";
import { AmountBreakdown } from "./AmountBreakdown";
import { PayoutComponents } from "./PayoutComponents";
import { getErrorMessage } from "./view-model";

export function PayoutAmounts({ row, accessToken }: { row: CanonicalRow; accessToken: string }) {
  const reportId = row.id ?? "";
  const currency = row.currency ?? "";
  const query = useQuery({
    queryKey: ["payout-type-totals", reportId],
    queryFn: ({ signal }) => fetchPayoutTypeTotals(accessToken, reportId, currency, signal),
    staleTime: Infinity,
  });
  const total = {
    currency,
    reportedAmount: row.source_amount,
    serviceFee: row.fee_amount,
    companyAmount: row.company_amount,
    rowCount: query.data?.reduce((count, value) => count + value.rowCount, 0) ?? 0,
    missingFeeCount: 0,
  };
  return (
    <AmountBreakdown
      stateKey={`payout:${reportId}`}
      currency={currency}
      savedTotal={total}
      totals={query.data}
      loading={query.isFetching}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      renderRecords={(selection) => (
        <PayoutComponents
          key={JSON.stringify([selection.types, selection.revision])}
          pageKey={`payout:${reportId}:selection:${String(selection.revision ?? 0)}`}
          reportId={reportId}
          currency={currency}
          accessToken={accessToken}
          types={selection.types}
        />
      )}
    />
  );
}
