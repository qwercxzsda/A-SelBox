import type { Identity } from "./auth-session";
import { PayoutReports } from "./PayoutReports";
import { useWorkspacePreference } from "./use-workspace-preference";
import { createDatasetViewState, type DatasetViewState } from "./workspace-view-state";
import { decodeDatasetView } from "./workspace-view-codec";

export function FinancialReviewSnapshots({
  identity,
  month,
  onRetry,
}: {
  identity: Identity;
  month: string;
  onRetry: () => Promise<void>;
}) {
  const [view, setView] = useWorkspacePreference(
    `financial-review:snapshots:${month}`,
    () => createDatasetViewState("payouts"),
    (value) => decodeDatasetView(value, "payouts"),
  );
  const scoped = (state: DatasetViewState): DatasetViewState => ({
    ...state,
    filters: { ...state.filters, dateFrom: `${month}-01`, dateTo: `${month}-01` },
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
    />
  );
}
