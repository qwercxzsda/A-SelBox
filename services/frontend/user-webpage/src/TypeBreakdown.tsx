import { useState, type ReactNode } from "react";
import type { TransactionTypeTotal } from "./api/types";
import { DetailDrawer } from "./DetailDrawer";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";
import { AmountBreakdown, type RecordSelection } from "./AmountBreakdown";
import type { TypeGroupId } from "./transaction-type-families";

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
  focusedGroup,
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
  focusedGroup?: TypeGroupId;
}) {
  // Restored open drawers mount fully entered and do not emit an enter callback.
  const [entered, setEntered] = useState(opened);
  return (
    <DetailDrawer
      opened={opened}
      onClose={onClose}
      onEnterTransitionEnd={() => {
        setEntered(true);
      }}
      onExitTransitionEnd={() => {
        setEntered(false);
      }}
      title="Transaction totals"
      context={`${title} · ${periodLabel} · UTC · ${currency}`}
      width="full"
    >
      <SummaryFilters filters={appliedFilters} />
      <AmountBreakdown
        key={stateKey}
        stateKey={stateKey}
        focusedGroup={focusedGroup}
        focusReady={opened && entered}
        currency={currency}
        totals={totals}
        loading={loading}
        error={error}
        onRetry={onRetry}
        renderRecords={renderRecords}
      />
    </DetailDrawer>
  );
}
