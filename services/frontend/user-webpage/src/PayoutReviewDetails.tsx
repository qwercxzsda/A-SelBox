import type { CanonicalRow } from "./api";
import { DetailSection } from "./DetailSection";
import { PayoutComponents } from "./PayoutComponents";
import { PayoutReconciliation } from "./PayoutReconciliation";
import { PayoutReconciliationTotals } from "./PayoutReconciliationTotals";
import { payoutMarketplaceLabel } from "./payout-report-scope";

export function PayoutReviewDetails({
  row,
  accessToken,
}: {
  row: CanonicalRow;
  accessToken: string;
}) {
  const reportId = row.id ?? "";
  const currency = row.currency;
  const marketplace = payoutMarketplaceLabel(row);
  const scope = {
    report_id: reportId,
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    marketplace_name: row.marketplace_name,
    currency,
  };
  return (
    <>
      <DetailSection
        title="Supporting records"
        description={`Saved comparison and analysis rows for this company, ${marketplace}, and ${currency ?? "no currency"}. Their amounts are exclusive of the company payout.`}
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
        title="Account reconciliation"
        collapsible
        description={`Calculated from this report's saved source inputs for ${currency ?? "this report"} and ${marketplace}, across all companies and SKUs in its source accounts for the report month. These are separate from this company's payout amounts. The same controls may appear in other reports; do not add them across reports.`}
      >
        <PayoutReconciliationTotals accessToken={accessToken} scope={scope} />
        <DetailSection
          stateKey={`payout-review:${reportId}:daily`}
          title="Daily source details"
          collapsible
          description="Daily rows compare native source amounts for each source account and marketplace. Differences are diagnostic and do not adjust the saved payout. Missing retrieval coverage is not treated as zero."
        >
          <PayoutReconciliation accessToken={accessToken} scope={scope} />
        </DetailSection>
      </DetailSection>
    </>
  );
}
