import { Alert } from "@mantine/core";
import type { DatasetFilters } from "./api";
import type { Identity } from "./auth-session";
import { usePayoutPolicy } from "./use-payout-policy";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { PayoutReadiness } from "./PayoutReadiness";

export function PayoutStatus({
  identity,
  filters,
  compact = false,
  onConfigureSku,
}: {
  identity: Identity;
  filters: DatasetFilters;
  compact?: boolean;
  onConfigureSku?: (sku: string) => void;
}) {
  const policy = usePayoutPolicy(identity);
  const recentMonth =
    filters.dateFrom && policy.data && filters.dateFrom > policy.data.latest_month;
  const month = (filters.dateFrom || (policy.data?.latest_month ?? "")).slice(0, 7);
  return (
    <>
      {!compact ? (
        <WorkspaceIntro
          description={
            <>
              Reports are generated automatically when eligible, and updated after source data or
              fees change.{" "}
              {policy.data
                ? `Months ending before ${policy.data.mature_cutoff_date} (UTC) are mature.`
                : policy.isPending
                  ? "Checking month eligibility…"
                  : "Month eligibility is temporarily unavailable; it will be checked again automatically."}
            </>
          }
        />
      ) : null}
      {recentMonth ? (
        <Alert color="blue" mb="md">
          This month is not mature yet. Reports will appear automatically once it is eligible and
          the required data is available.
        </Alert>
      ) : null}
      {month ? (
        <PayoutReadiness
          key={`${month}:${JSON.stringify(filters.companyIds)}`}
          identity={identity}
          month={month}
          companyIds={filters.companyIds}
          onConfigureSku={onConfigureSku}
        />
      ) : null}
    </>
  );
}
