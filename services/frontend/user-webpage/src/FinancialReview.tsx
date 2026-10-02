import { Tabs } from "@mantine/core";
import type { Identity } from "./auth-session";
import { FinancialReviewMonths } from "./FinancialReviewMonths";
import { useWorkspacePreference } from "./use-workspace-preference";
import { REVIEW_CATEGORIES, reviewCategory } from "./financial-review-categories";

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
  if (identity.account.access_role !== "operator") return null;
  return (
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
          identity={identity}
          onRetry={onRetry}
        />
      </Tabs.Panel>
    </Tabs>
  );
}
