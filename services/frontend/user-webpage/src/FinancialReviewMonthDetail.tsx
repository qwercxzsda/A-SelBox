import { Badge, Button, Drawer, Group, Text, Title } from "@mantine/core";
import type { Identity } from "./auth-session";
import { formatRecordMonth } from "./date-display";
import { FinancialReviewMonthContent } from "./FinancialReviewMonthContent";
import { reviewCategoryLabel, type ReviewCategory } from "./financial-review-categories";
import "./FinancialReviewMonthDetail.css";

export function FinancialReviewMonthDetail({
  identity,
  category,
  onRetry,
  month,
  matureCutoff,
  months,
  onSelect,
  onClose,
}: {
  identity: Identity;
  category: ReviewCategory;
  onRetry: () => Promise<void>;
  month: string | null;
  matureCutoff: string;
  months: string[];
  onSelect: (month: string) => void;
  onClose: () => void;
}) {
  const index = month ? months.indexOf(month) : -1;
  const newerMonth = index > 0 ? months[index - 1] : null;
  const olderMonth = index >= 0 ? (months[index + 1] ?? null) : null;
  return (
    <Drawer.Stack>
      <Drawer
        stackId="monthly-financial-review"
        opened={month !== null && matureCutoff !== ""}
        onClose={onClose}
        position="right"
        size="min(1440px, 100vw)"
        padding="lg"
        title="Monthly financial review"
        closeButtonProps={{ "aria-label": "Close monthly financial review" }}
      >
        {month ? (
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
                  <Badge color="gray" variant="light">
                    {reviewCategoryLabel(category)} · Current sources
                  </Badge>
                  {month === matureCutoff.slice(0, 7) ? (
                    <Badge color="gray" variant="light">
                      Partial month
                    </Badge>
                  ) : null}
                </Group>
                <Text size="sm" c="dimmed" mt={4}>
                  All source accounts · All companies · All marketplaces · All SKUs
                </Text>
              </div>
              {months.length > 1 ? (
                <Group component="nav" aria-label="Review months on this page" gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!newerMonth}
                    onClick={() => {
                      if (newerMonth) onSelect(newerMonth);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!olderMonth}
                    onClick={() => {
                      if (olderMonth) onSelect(olderMonth);
                    }}
                  >
                    Next
                  </Button>
                </Group>
              ) : null}
            </Group>
            {matureCutoff ? (
              <Text size="xs" c="dimmed" mb="lg">
                Includes mature dates before {matureCutoff} (UTC) only. Source coverage may be
                incomplete.
              </Text>
            ) : null}
            {matureCutoff ? (
              <FinancialReviewMonthContent
                key={`${category}:${month}`}
                identity={identity}
                category={category}
                onRetry={onRetry}
                month={month}
                matureCutoff={matureCutoff}
              />
            ) : (
              <Text role="status">Loading financial review…</Text>
            )}
          </>
        ) : null}
      </Drawer>
    </Drawer.Stack>
  );
}
