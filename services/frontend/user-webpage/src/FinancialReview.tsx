import { Tabs } from "@mantine/core";
import type { Identity } from "./auth-session";
import { FinancialReviewMonths } from "./FinancialReviewMonths";
import { useWorkspacePreference } from "./use-workspace-preference";
import { REVIEW_CATEGORIES, reviewCategory } from "./financial-review-categories";
import { createReviewScope, decodeReviewScope } from "./financial-review-view";
import { WorkspaceHeader } from "./WorkspaceHeader";

export function FinancialReview({
  identity,
  onRetry,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
}) {
  const [category, setCategory] = useWorkspacePreference(
    "financial-review:category",
    () => reviewCategory(null),
    reviewCategory,
  );
  const [scope, setScope] = useWorkspacePreference(
    "financial-review:scope",
    createReviewScope,
    decodeReviewScope,
  );
  if (identity.account.access_role !== "administrator") return null;
  return (
    <>
      <WorkspaceHeader
        title="Financial review"
        help={
          <>
            <p>
              Compare Finances and Data Kiosk by marketplace, year, currency, and fee family. This
              view includes all source accounts and companies.
            </p>
            <p>{REVIEW_CATEGORIES.find(({ value }) => value === category)?.description}</p>
            <p>
              Differences are diagnostic and do not change company payouts. Open a month for source
              records and saved report snapshots.
            </p>
          </>
        }
      />
      <Tabs
        value={category}
        onChange={(value) => {
          setCategory(reviewCategory(value));
        }}
      >
        <Tabs.List aria-label="Financial review">
          {REVIEW_CATEGORIES.map(({ value, label }) => (
            <Tabs.Tab key={value} value={value}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value={category} pt="md">
          <FinancialReviewMonths
            key={category}
            category={category}
            scope={scope}
            onScopeChange={setScope}
            identity={identity}
            onRetry={onRetry}
          />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
