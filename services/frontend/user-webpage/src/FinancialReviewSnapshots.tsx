import { reviewPeriodKey } from "./financial-review-scope-key";
import type { Identity } from "./auth-session";
import { PayoutReports } from "./PayoutReports";
import { useWorkspacePreference } from "./use-workspace-preference";
import { createDatasetViewState, type DatasetViewState } from "./workspace-view-state";
import { decodeDatasetView } from "./workspace-view-codec";

export function FinancialReviewSnapshots({
  identity,
  month,
  currency,
  marketplace,
  onRetry,
}: {
  identity: Identity;
  month: string;
  currency: string;
  marketplace: string;
  onRetry: () => Promise<void>;
}) {
  const [view, setView] = useWorkspacePreference(
    `financial-review:snapshots:${reviewPeriodKey(month, marketplace, currency)}`,
    () => createDatasetViewState("payouts"),
    (value) => decodeDatasetView(value, "payouts"),
  );
  const scoped = (state: DatasetViewState): DatasetViewState => ({
    ...state,
    filters: {
      ...state.filters,
      marketplaces: [marketplace],
      dateFrom: `${month}-01`,
      dateTo: `${month}-01`,
    },
  });
  return (
    <PayoutReports
      identity={identity}
      viewState={scoped(view)}
      onViewStateChange={(update) => {
        setView((current) =>
          scoped(typeof update === "function" ? update(scoped(current)) : update),
        );
      }}
      onRetry={onRetry}
      reviewMode
      fixedMonth
      currency={currency}
      marketplace={marketplace}
    />
  );
}
