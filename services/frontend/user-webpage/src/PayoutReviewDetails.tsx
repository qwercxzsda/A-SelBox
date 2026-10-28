import type { CanonicalRow } from "./api";
import { DetailSection } from "./DetailSection";
import { PayoutComponents } from "./PayoutComponents";
import { PayoutReconciliation } from "./PayoutReconciliation";
import { PayoutReconciliationTotals } from "./PayoutReconciliationTotals";

export function PayoutReviewDetails({
  row,
  accessToken,
}: {
  row: CanonicalRow;
  accessToken: string;
}) {
  const reportId = row.id ?? "";
  const currency = row.currency;
  return (
    <>
      <DetailSection
        title="Supporting records"
        description="Saved comparison and analysis rows for this company and report currency. Their amounts are exclusive of the company payout."
      >
        <PayoutComponents
          reportId={reportId}
          currency={currency ?? ""}
          accessToken={accessToken}
          authoritative={false}
        />
      </DetailSection>
      <DetailSection
        stateKey={`payout-review:${reportId}:reconciliation`}
        title="Saved account reconciliation"
        collapsible
        description={`Account controls saved for ${currency ?? "this report"}, across all companies, marketplaces and SKUs in its source accounts for the report month. They are not this company's payout amounts. The same controls may appear in other reports; do not add them across reports.`}
      >
        <PayoutReconciliationTotals
          accessToken={accessToken}
          reportId={reportId}
          currency={currency}
        />
        <DetailSection
          stateKey={`payout-review:${reportId}:daily`}
          title="Saved daily source details"
          collapsible
          description="Daily rows separate source accounts and marketplaces. Total after adding difference equals Finances total by construction; it does not confirm that the sources agree."
        >
          <PayoutReconciliation accessToken={accessToken} reportId={reportId} currency={currency} />
        </DetailSection>
      </DetailSection>
    </>
  );
}
