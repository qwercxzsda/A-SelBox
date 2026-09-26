import { useMemo } from "react";
import { Alert, Button, Drawer, Group, Paper, Skeleton, Stack, Text, Title } from "@mantine/core";
import type { TransactionTypeTotal } from "./api/types";
import { groupTransactionTypes, totalTransactionTypes } from "./type-breakdown-groups";
import { TypeBreakdownRows } from "./TypeBreakdownRows";
import { FinancialAmounts } from "./FinancialAmounts";
import { UpdateStatus } from "./UpdateStatus";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import "./TypeBreakdown.css";

interface TypeBreakdownProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  periodLabel: string;
  currency: string;
  totals: TransactionTypeTotal[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  appliedFilters?: SummaryFilter[];
}

export function TypeBreakdown({
  opened,
  onClose,
  title,
  periodLabel,
  currency,
  totals,
  loading,
  error,
  onRetry,
  appliedFilters = [],
}: TypeBreakdownProps) {
  const groups = useMemo(() => groupTransactionTypes(totals ?? [], currency), [totals, currency]);
  const total = useMemo(() => totalTransactionTypes(totals ?? [], currency), [totals, currency]);
  const typeCount = groups.reduce((count, group) => count + group.types.length, 0);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Amounts by type"
      position="right"
      size="min(960px, 100vw)"
      padding="lg"
      closeButtonProps={{ "aria-label": "Close breakdown" }}
    >
      <Title order={3} size="h4" style={{ overflowWrap: "anywhere" }}>
        {title}
      </Title>
      <Text c="dimmed" size="sm" mt={4} mb="sm">
        Dates: {periodLabel} · {currency}
      </Text>
      <SummaryFilters filters={appliedFilters} />
      {error ? (
        <Alert color="red" role="alert" mb="md">
          <Stack gap="xs" align="start">
            {error}
            <Button color="red" variant="subtle" loading={loading} onClick={onRetry}>
              Retry breakdown
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {loading && totals === undefined ? (
        <Stack gap="md" role="status" aria-label="Loading amounts by type">
          <Skeleton height={32} />
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </Stack>
      ) : groups.length > 0 ? (
        <>
          <UpdateStatus active={loading} mb="sm">
            Updating amounts…
          </UpdateStatus>
          <Text size="xs" c="dimmed" ta="right" pr={44} mb={4}>
            Company amount
          </Text>
          <TypeBreakdownRows groups={groups} />
          <Paper
            component="section"
            className="type-breakdown-total"
            aria-label="Breakdown total"
            withBorder
            p="md"
            mt="lg"
          >
            <Group justify="space-between" gap="xs">
              <Text component="h3" m={0} fw={600}>
                Total
              </Text>
              <Text size="xs" c="dimmed">
                {total.rowCount.toLocaleString("en-US")}{" "}
                {total.rowCount === 1 ? "record" : "records"} across{" "}
                {typeCount.toLocaleString("en-US")} {typeCount === 1 ? "type" : "types"}
              </Text>
            </Group>
            <FinancialAmounts total={total} />
            {total.missingFeeCount > 0 ? (
              <Text size="sm" c="orange.9" role="note" mt="sm">
                {total.missingFeeCount.toLocaleString("en-US")}{" "}
                {total.missingFeeCount === 1 ? "transaction has" : "transactions have"} uncalculated
                amounts. Totals include known amounts.
              </Text>
            ) : null}
          </Paper>
        </>
      ) : !error ? (
        <Text c="dimmed">No transactions for this period in {currency}.</Text>
      ) : null}
    </Drawer>
  );
}
