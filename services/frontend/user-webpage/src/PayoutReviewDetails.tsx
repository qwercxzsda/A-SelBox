import { useQuery } from "@tanstack/react-query";
import { fetchPayoutReconciliationTotals, type CanonicalRow } from "./api";
import { DetailSection } from "./DetailSection";
import { PayoutComponents } from "./PayoutComponents";
import { PayoutReconciliation } from "./PayoutReconciliation";
import { PayoutReconciliationTotals } from "./PayoutReconciliationTotals";

function SavedAccountReconciliation({
  accessToken,
  reportId,
}: {
  accessToken: string;
  reportId: string;
}) {
  const query = useQuery({
    queryKey: ["payout-reconciliation-totals", reportId],
    queryFn: ({ signal }) => fetchPayoutReconciliationTotals(accessToken, reportId, signal),
    staleTime: Infinity,
  });
  return (
    <>
      <PayoutReconciliationTotals query={query} />
      <DetailSection
        stateKey={`payout-review:${reportId}:daily`}
        title="Saved daily source details"
        collapsible
        description="Daily rows separate source accounts and marketplaces. Total after adding difference equals Settlement total by construction; it does not confirm that the sources agree."
      >
        <PayoutReconciliation accessToken={accessToken} reportId={reportId} />
      </DetailSection>
    </>
  );
}

export function PayoutReviewDetails({
  row,
  accessToken,
}: {
  row: CanonicalRow;
  accessToken: string;
}) {
  const reportId = row.id ?? "";
  return (
    <>
      <DetailSection
        title="Supporting records"
        description="Saved comparison and analysis rows for this company and report currency. Their amounts are exclusive of the company payout."
      >
        <PayoutComponents
          reportId={reportId}
          currency={row.currency ?? ""}
          accessToken={accessToken}
          authoritative={false}
        />
      </DetailSection>
      <DetailSection
        stateKey={`payout-review:${reportId}:reconciliation`}
        title="Saved account reconciliation"
        collapsible
        description="Account controls saved when this report was generated, across all companies, marketplaces, SKUs and currencies in its source accounts for the report month. They are not this company's payout amounts. The same controls may appear in other reports; do not add them across reports."
      >
        <SavedAccountReconciliation accessToken={accessToken} reportId={reportId} />
      </DetailSection>
    </>
  );
}
