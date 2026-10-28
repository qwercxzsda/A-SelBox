import { Tabs, Text } from "@mantine/core";
import type { Identity } from "./auth-session";
import { FinancialReviewMonths } from "./FinancialReviewMonths";
import { useWorkspacePreference } from "./use-workspace-preference";
import { REVIEW_CATEGORIES, reviewCategory } from "./financial-review-categories";
import { createReviewScope, decodeReviewScope } from "./financial-review-view";

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
    <Tabs
      value={category}
      onChange={(value) => {
        setCategory(reviewCategory(value));
      }}
    >
      <Text size="xs" c="dimmed" mb={4}>
        Comparison category · Each category compares Finances with Data Kiosk.
      </Text>
      <Tabs.List aria-label="Financial review">
        {REVIEW_CATEGORIES.map(({ value, label }) => (
          <Tabs.Tab key={value} value={value}>
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value={category} pt="md">
        <FinancialReviewMonths
          key={`${category}:${scope.year}:${scope.currency}`}
          category={category}
          scope={scope}
          onScopeChange={setScope}
          identity={identity}
          onRetry={onRetry}
        />
      </Tabs.Panel>
    </Tabs>
  );
}
