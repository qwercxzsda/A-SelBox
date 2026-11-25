import { useQuery, type QueryKey } from "@tanstack/react-query";
import { fetchFinancialOutcomes } from "./api";
import type { OutcomeFilters } from "./api/financial-review";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { FinancialReviewOutcomeTable, type OpenedOutcome } from "./FinancialReviewOutcomeTable";

/**
 * One outcome's records keep the previous rows while another page, month, reason or group
 * loads, so the drawer does not shrink to a loading line; nothing else reuses them.
 */
function sameOutcomeRecords(left: QueryKey, right: QueryKey) {
  return left.slice(0, 5).every((part, index) => part === right[index]);
}

/** A month's records, 50 per page; the months' record count is the exact total. */
export function FinancialReviewRecords({
  identity,
  filters,
  pageIndex,
  onPageChange,
  totalCount,
  currency,
  label,
  items,
  openedKey,
  onOpenRecord,
}: {
  identity: Identity;
  filters: OutcomeFilters;
  /** Kept by the month drawer, which starts every other month, reason or group on page 1. */
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
  totalCount: number;
  currency: string;
  /** The table name, such as "Difference records". */
  label: string;
  /** The same in running text, such as "difference records". */
  items: string;
  openedKey: string | null;
  onOpenRecord: (opened: OpenedOutcome) => void;
}) {
  const { outcome, marketplace, month, reason, selboxGroup } = filters;
  const code = reason ?? selboxGroup;
  const queryKey = [
    "financial-review",
    identity.session.user.id,
    "records",
    outcome,
    marketplace,
    month,
    reason,
    selboxGroup,
    pageIndex,
  ];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchFinancialOutcomes(identity.session.access_token, filters, pageIndex, signal),
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameOutcomeRecords(previousQuery.queryKey, queryKey) ? previous : undefined,
  });
  const rows = query.data ?? [];
  return (
    <DetailData
      query={query}
      label={items}
      rowCount={rows.length}
      emptyMessage="No records"
      pagination={{ pageIndex, totalCount, onPageChange }}
    >
      {rows.length ? (
        <div
          className="financial-review-records"
          data-placeholder={query.isPlaceholderData || undefined}
          aria-busy={query.isPlaceholderData}
        >
          <FinancialReviewOutcomeTable
            label={label}
            outcome={outcome}
            rows={rows}
            currency={currency}
            showCode={code === null}
            openedKey={openedKey}
            onOpenRecord={onOpenRecord}
          />
        </div>
      ) : null}
    </DetailData>
  );
}
