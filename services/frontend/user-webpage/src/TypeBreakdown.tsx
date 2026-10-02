import type { ReactNode } from "react";
import { Drawer, Text, Title } from "@mantine/core";
import type { TransactionTypeTotal } from "./api/types";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import { AmountBreakdown, type RecordSelection } from "./AmountBreakdown";

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
  renderRecords,
  stateKey,
}: {
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
  renderRecords: (selection: RecordSelection) => ReactNode;
  stateKey: string;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Amounts by type"
      position="right"
      size="min(1440px, 100vw)"
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
      <AmountBreakdown
        key={stateKey}
        stateKey={stateKey}
        currency={currency}
        totals={totals}
        loading={loading}
        error={error}
        onRetry={onRetry}
        renderRecords={renderRecords}
      />
    </Drawer>
  );
}
