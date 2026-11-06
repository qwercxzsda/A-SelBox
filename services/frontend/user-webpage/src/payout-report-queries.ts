import { queryOptions, skipToken } from "@tanstack/react-query";
import { fetchPayoutHistory, fetchPayoutVersion } from "./api";
import type { Identity } from "./auth-session";
import type { PayoutReportScope, PayoutVersionSelection } from "./payout-report-scope";

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
    queryFn: selection
      ? ({ signal }) =>
          fetchPayoutVersion({
            accessToken: identity.session.access_token,
            ...selection,
            signal,
          })
      : skipToken,
  });
}

export function payoutHistoryQueryOptions(
  identity: Identity,
  scope: PayoutReportScope | null,
  pageIndex: number,
) {
  return queryOptions({
    queryKey: [
      "payout-history",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      scope?.companyId,
      scope?.startDate,
      scope?.endDate,
      scope?.marketplaceName,
      scope?.currency,
      pageIndex,
    ],
    queryFn: scope
      ? ({ signal }) =>
          fetchPayoutHistory({
            accessToken: identity.session.access_token,
            ...scope,
            pageIndex,
            signal,
          })
      : skipToken,
  });
}
