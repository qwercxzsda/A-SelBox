import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Alert, Button, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import type { CurrencyTotal, TransactionTypeTotal } from "./api/types";
import { groupTransactionTypes, totalTransactionTypes } from "./type-breakdown-groups";
import { TypeBreakdownRows } from "./TypeBreakdownRows";
import { TypeBreakdownAmounts } from "./TypeBreakdownAmounts";
import { FinancialAmounts } from "./FinancialAmounts";
import { UpdateStatus } from "./UpdateStatus";
import { DetailSection } from "./DetailSection";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeRecordSelection } from "./detail-view-state";
import "./TypeBreakdown.css";

export interface RecordSelection {
  label: string;
  types: string[];
  revision?: number;
}

/** Estimates and saved reports use the same totals, type drilldown, and records. */
export function AmountBreakdown({
  currency,
  totals,
  savedTotal,
  loading,
  error,
  onRetry,
  renderRecords,
  stateKey,
}: {
  currency: string;
  totals: TransactionTypeTotal[] | undefined;
  savedTotal?: CurrencyTotal;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  renderRecords: (selection: RecordSelection) => ReactNode;
  stateKey: string;
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
  const total = savedTotal ?? totalTransactionTypes(totals ?? [], currency);
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
          mb="lg"
        >
          <Group justify="space-between" gap="xs">
            <Text component="h3" m={0} fw={600} size="lg">
              Total
            </Text>
            {totals !== undefined ? (
              <Text size="xs" c="dimmed">
                {total.rowCount.toLocaleString("en-US")}{" "}
                {total.rowCount === 1 ? "record" : "records"} across{" "}
                {typeCount.toLocaleString("en-US")} {typeCount === 1 ? "type" : "types"}
              </Text>
            ) : null}
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
      ) : null}
      <DetailSection
        ref={amountsRef}
        title="Amounts by type"
        description="Breakdown of the total above by type. Expand a category to view its types and records."
      >
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
          </Stack>
        ) : groups.length > 0 ? (
          <>
            <UpdateStatus active={loading} mb="sm">
              Updating amounts…
            </UpdateStatus>
            <TypeBreakdownRows
              stateKey={stateKey}
              groups={groups}
              onSelectRecords={selectRecords}
            />
            <section className="type-breakdown-footer" aria-label="Amounts by type total">
              <span className="type-breakdown-group-name">Total</span>
              <TypeBreakdownAmounts total={totalTransactionTypes(totals ?? [], currency)} />
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
