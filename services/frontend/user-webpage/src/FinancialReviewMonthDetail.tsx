import { Badge, Button, Drawer, Group, Text, Title } from "@mantine/core";
import type { Identity } from "./auth-session";
import { formatRecordMonth } from "./date-display";
import { FinancialReviewMonthContent } from "./FinancialReviewMonthContent";
import { reviewCategoryLabel, type ReviewCategory } from "./financial-review-categories";
import "./FinancialReviewMonthDetail.css";

export function FinancialReviewMonthDetail({
  identity,
  category,
  currency,
  onRetry,
  month,
  matureCutoff,
  latestMonth,
  months,
  onSelect,
  onClose,
  onExitTransitionEnd,
}: {
  identity: Identity;
  category: ReviewCategory;
  currency: string;
  onRetry: () => Promise<void>;
  month: string | null;
  matureCutoff: string;
  latestMonth: string;
  months: string[];
  onSelect: (month: string) => void;
  onClose: () => void;
  onExitTransitionEnd: () => void;
}) {
  const opened = month !== null && latestMonth !== "";
  const index = month ? months.indexOf(month) : -1;
  const olderMonth = index > 0 ? months[index - 1] : null;
  const newerMonth = index >= 0 ? (months[index + 1] ?? null) : null;
  return (
    <Drawer.Stack>
      <Drawer
        stackId="monthly-financial-review"
        opened={opened}
        onClose={onClose}
        onExitTransitionEnd={onExitTransitionEnd}
        position="right"
        size="min(1440px, 100vw)"
        padding="lg"
        title="Monthly financial review"
        closeButtonProps={{ "aria-label": "Close monthly financial review" }}
      >
        {opened ? (
          <>
            <Group
              className="monthly-review-heading"
              justify="space-between"
              align="flex-start"
              mb="md"
            >
              <div className="monthly-review-title">
                <Group gap="sm">
                  <Title order={3}>{formatRecordMonth(month)}</Title>
                  <Badge variant="light">{currency}</Badge>
                  <Badge color="gray" variant="light">
                    {reviewCategoryLabel(category)} · Current sources
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed" mt={4}>
                  All source accounts · All companies · All marketplaces · All SKUs
                </Text>
              </div>
              {months.length > 1 ? (
                <Group component="nav" aria-label="Review months in this year" gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!olderMonth}
                    onClick={() => {
                      if (olderMonth) onSelect(olderMonth);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!newerMonth}
                    onClick={() => {
                      if (newerMonth) onSelect(newerMonth);
                    }}
                  >
                    Next
                  </Button>
                </Group>
              ) : null}
            </Group>
            <Text size="xs" c="dimmed" mb="lg">
              Full mature months through {formatRecordMonth(latestMonth)}. Uses the same
              mature-month window as payout reports.
            </Text>
            <FinancialReviewMonthContent
              key={`${category}:${month}:${currency}`}
              identity={identity}
              category={category}
              currency={currency}
              onRetry={onRetry}
              month={month}
              matureCutoff={matureCutoff}
            />
          </>
        ) : null}
      </Drawer>
    </Drawer.Stack>
  );
}
