import { Paper, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import type { CurrencyTotal } from "./api";
import type { DateRange } from "./estimated-periods";
import type { SummaryPeriod } from "./summary-types";
import { FinancialAmounts } from "./FinancialAmounts";

function SummaryAmounts({ total }: { total: CurrencyTotal }) {
  const incomplete = total.missingFeeCount > 0;
  return (
    <>
      <FinancialAmounts total={total} className="estimated-summary-amounts" />
      <Text size="xs" c="dimmed">
        {total.rowCount.toLocaleString("en-US")} {total.rowCount === 1 ? "record" : "records"}
      </Text>
      {incomplete ? (
        <Text size="sm" c="orange.9" mt="xs" role="note">
          {total.missingFeeCount.toLocaleString("en-US")}{" "}
          {total.missingFeeCount === 1 ? "transaction has" : "transactions have"} uncalculated
          amounts.
        </Text>
      ) : total.companyAmount === null ? (
        <Text size="sm" c="dimmed" mt="xs" role="note">
          Company amount unavailable.
        </Text>
      ) : null}
    </>
  );
}

export function SummaryCard({
  title,
  period,
  currency,
  loading,
  error,
  emptyMessage,
  onPeriodSelect,
  onOpenBreakdown,
}: {
  title: string;
  period: SummaryPeriod | null;
  currency: string | null;
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  onPeriodSelect?: (range: DateRange) => void;
  onOpenBreakdown: (period: SummaryPeriod, title: string, currency: string) => void;
}) {
  const total = period?.totals.find((item) => item.currency === currency);
  const initialLoading = loading && period === null;

  return (
    <Paper
      component="article"
      className="estimated-summary-card"
      withBorder
      p="md"
      aria-label={`${title} estimated totals`}
    >
      {period && total && total.rowCount > 0 && currency ? (
        <UnstyledButton
          className="estimated-summary-open"
          type="button"
          aria-label={`View ${title} by type`}
          aria-haspopup="dialog"
          onClick={() => {
            onOpenBreakdown(period, title, currency);
          }}
        />
      ) : null}
      <Text component="h3" m={0} fw={600} size="sm">
        {title}
      </Text>
      {initialLoading ? (
        <Stack gap="sm" mt="sm" role="status" aria-label={`Loading ${title.toLowerCase()} totals`}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={16} mt="xs" />
          <Skeleton height={16} />
          <Skeleton height={28} width="75%" mt="xs" />
          <Skeleton height={12} width="25%" />
        </Stack>
      ) : (
        <>
          {period ? (
            onPeriodSelect ? (
              <UnstyledButton
                className="estimated-summary-period"
                type="button"
                aria-label={`Filter transactions to ${period.label}`}
                onClick={() => {
                  onPeriodSelect(period.range);
                }}
              >
                {period.label}
              </UnstyledButton>
            ) : (
              <Text size="sm" c="dimmed" mt={4}>
                {period.label}
              </Text>
            )
          ) : null}
          {period && total && total.rowCount > 0 ? (
            <>
              <SummaryAmounts total={total} />
              <Text className="estimated-summary-affordance" size="xs" mt="sm" aria-hidden="true">
                View by type →
              </Text>
            </>
          ) : (
            <Text className="estimated-summary-empty" c="dimmed" size="sm">
              {period
                ? currency
                  ? `No transactions in ${currency}.`
                  : "No transactions for this period."
                : error
                  ? "Summary unavailable."
                  : emptyMessage}
            </Text>
          )}
        </>
      )}
    </Paper>
  );
}
