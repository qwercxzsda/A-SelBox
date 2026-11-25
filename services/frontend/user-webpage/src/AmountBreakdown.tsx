import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Button, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import type { CurrencyTotal, TransactionTypeTotal } from "./api/types";
import { groupTransactionTypes, totalTransactionTypes } from "./type-breakdown-groups";
import { TypeBreakdownRows } from "./TypeBreakdownRows";
import { TypeBreakdownAmounts } from "./TypeBreakdownAmounts";
import { FinancialAmounts, MissingFeeRateNote } from "./FinancialAmounts";
import { countLabel } from "./pagination";
import { LoadingStatus } from "./LoadingStatus";
import { DetailSection } from "./DetailSection";
import { ErrorAlert } from "./ErrorAlert";
import { HelpPopover } from "./HelpPopover";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeRecordSelection } from "./detail-view-state";
import type { TypeGroupId } from "./transaction-type-families";
import "./TypeBreakdown.css";

export interface RecordSelection {
  label: string;
  types: string[];
  revision?: number;
}

/** Current totals and saved reports use the same totals, type drilldown, and records. */
export function AmountBreakdown({
  currency,
  totals,
  savedTotal,
  loading,
  error,
  onRetry,
  renderRecords,
  stateKey,
  focusedGroup,
  focusReady = true,
}: {
  currency: string;
  totals: TransactionTypeTotal[] | undefined;
  savedTotal?: CurrencyTotal;
  loading: boolean;
  /** The short cause of a failed read (`loadErrorDetail`). */
  error: string | null;
  onRetry: () => void;
  renderRecords: (selection: RecordSelection) => ReactNode;
  stateKey: string;
  focusedGroup?: TypeGroupId;
  focusReady?: boolean;
}) {
  const [selection, setSelection] = useWorkspacePreference<RecordSelection>(
    `${stateKey}:record-selection`,
    () => ({ label: "All records", types: [] }),
    decodeRecordSelection,
  );
  const recordsRef = useRef<HTMLElement>(null);
  const amountsRef = useRef<HTMLElement>(null);
  const shouldScroll = useRef(false);
  const groups = useMemo(() => groupTransactionTypes(totals ?? [], currency), [totals, currency]);
  const typeTotal = totalTransactionTypes(totals ?? [], currency);
  const total = savedTotal ?? typeTotal;
  const typeCount = groups.reduce((count, group) => count + group.types.length, 0);
  function selectRecords(next: RecordSelection) {
    shouldScroll.current = true;
    // A changed filter starts on page one; reloading retains the selected page.
    setSelection((current) => ({ ...next, revision: (current.revision ?? 0) + 1 }));
  }
  useLayoutEffect(() => {
    if (!shouldScroll.current) return;
    shouldScroll.current = false;
    recordsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    recordsRef.current?.focus({ preventScroll: true });
  }, [selection]);
  return (
    <>
      {savedTotal || totals !== undefined ? (
        <Paper
          component="section"
          className="type-breakdown-total"
          aria-label="Breakdown total"
          withBorder
          p="md"
        >
          <Group justify="space-between" gap="xs">
            <Group gap={6} wrap="nowrap">
              <Text component="h3" m={0} fw={600} size="lg">
                Total
              </Text>
              <HelpPopover label="Total help">
                Amounts show 2 decimals. Totals use full precision, so rows may not add up exactly.
                {total.missingFeeCount > 0
                  ? " Company amount leaves out records without a fee rate; add the rates in Current fees."
                  : null}
              </HelpPopover>
            </Group>
            {totals !== undefined ? (
              <Text size="xs" c="dimmed">
                {countLabel(total.rowCount, "records")} across {countLabel(typeCount, "types")}
              </Text>
            ) : null}
          </Group>
          <FinancialAmounts total={total} />
          <MissingFeeRateNote count={total.missingFeeCount} mt="xs" />
        </Paper>
      ) : null}
      <DetailSection
        ref={amountsRef}
        title="Amounts by type"
        actions={<LoadingStatus state={loading && totals !== undefined ? "updating" : null} />}
      >
        {error ? (
          <ErrorAlert
            title="Could not load amounts by type"
            detail={error}
            retrying={loading}
            onRetry={onRetry}
          />
        ) : null}
        {loading && totals === undefined ? (
          <Stack gap="md" role="status" aria-label="Loading amounts by type">
            <Skeleton height={32} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </Stack>
        ) : groups.length > 0 ? (
          <>
            <TypeBreakdownRows
              stateKey={stateKey}
              focusedGroup={focusedGroup}
              focusReady={focusReady}
              groups={groups}
              onSelectRecords={selectRecords}
            />
            <section className="type-breakdown-footer" aria-label="Amounts by type total">
              <span className="type-breakdown-group-name">Total</span>
              <TypeBreakdownAmounts total={typeTotal} />
            </section>
          </>
        ) : !error ? (
          <Text c="dimmed">No amounts for this period{currency ? ` in ${currency}` : ""}.</Text>
        ) : null}
      </DetailSection>
      <DetailSection
        ref={recordsRef}
        title="Records"
        label="Amount records"
        description={selection.label}
        actions={
          <Group gap="xs">
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                amountsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
                amountsRef.current?.focus({ preventScroll: true });
              }}
            >
              Back to amounts
            </Button>
            {selection.types.length > 0 ? (
              <Button
                variant="light"
                size="xs"
                onClick={() => {
                  selectRecords({ label: "All records", types: [] });
                }}
              >
                Show all records
              </Button>
            ) : null}
          </Group>
        }
      >
        {renderRecords(selection)}
      </DetailSection>
    </>
  );
}
