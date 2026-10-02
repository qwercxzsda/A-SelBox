import { queryOptions } from "@tanstack/react-query";
import { fetchPayoutHistory, fetchPayoutVersion } from "./api";
import type { Identity } from "./auth-session";
import type { PayoutVersionSelection } from "./payout-report-view";

export function payoutVersionQueryOptions(
  identity: Identity,
  selection: PayoutVersionSelection | null,
) {
  return queryOptions({
    queryKey: [
      "payout-history",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      "version",
      selection,
    ],
    queryFn: ({ signal }) =>
      selection
        ? fetchPayoutVersion({
            accessToken: identity.session.access_token,
            ...selection,
            signal,
          })
        : null,
    enabled: selection !== null,
  });
}

export function payoutHistoryQueryOptions(
  identity: Identity,
  scope: Omit<PayoutVersionSelection, "reportId">,
  pageIndex: number,
) {
  return queryOptions({
    queryKey: [
      "payout-history",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      scope.companyId,
      scope.startDate,
      scope.endDate,
      scope.currency,
      pageIndex,
    ],
    queryFn: ({ signal }) =>
      fetchPayoutHistory({
        accessToken: identity.session.access_token,
        ...scope,
        pageIndex,
        signal,
      }),
  });
}
