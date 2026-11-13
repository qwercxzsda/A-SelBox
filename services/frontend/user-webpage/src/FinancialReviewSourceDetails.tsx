import { reviewPeriodKey } from "./financial-review-scope-key";
import { useRef } from "react";
import { Button, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { FinancialReviewRecords } from "./FinancialReviewRecords";
import { FinancialReviewTypes } from "./FinancialReviewTypes";
import {
  createReviewSourceState,
  decodeReviewSourceState,
  type ReviewSourceState,
  type FinancialReviewMonthScope,
  reviewFamilyStateKey,
} from "./financial-review-source-state";
import { useWorkspacePreference } from "./use-workspace-preference";
import { FinancialReviewFamilies } from "./FinancialReviewFamilies";
import { DetailSection } from "./DetailSection";
import { revealSection } from "./reveal-section";

export function FinancialReviewSourceDetails({
  total,
  ...scope
}: FinancialReviewMonthScope & { total?: CanonicalRow }) {
  const { category, month, currency, marketplace, families } = scope;
  const periodKey = reviewPeriodKey(month, marketplace, currency);
  const [state, setSaved] = useWorkspacePreference(
    `financial-review:sources:${category}:${periodKey}${reviewFamilyStateKey(families)}`,
    createReviewSourceState,
    decodeReviewSourceState,
  );
  const amountsRef = useRef<HTMLElement>(null);
  const recordsRef = useRef<HTMLElement>(null);
  function change(patch: Partial<ReviewSourceState>) {
    setSaved((current) => ({ ...current, ...patch }));
  }
  const sourceProps = { ...scope, state, change };
  return (
    <>
      <Text size="xs" c="dimmed" mt="lg" mb="sm">
        {marketplace} · Records in {currency}
        {total ? (
          <>
            {" "}
            · Finances: {total.finances_row_count ?? "Unavailable"} · Data Kiosk:{" "}
            {total.data_kiosk_row_count ?? "Unavailable"}
          </>
        ) : null}
      </Text>
      <DetailSection
        stateKey={`financial-review:families:${category}:${periodKey}`}
        title="Fee family comparison"
        collapsible
      >
        <FinancialReviewFamilies {...scope} />
      </DetailSection>
      <DetailSection
        ref={amountsRef}
        title="Amounts by type"
        description="Select a type to inspect its exact source records for this marketplace, category, month and currency."
      >
        <FinancialReviewTypes
          {...sourceProps}
          onSelect={() => {
            requestAnimationFrame(() => {
              revealSection(recordsRef.current);
            });
          }}
        />
      </DetailSection>
      <DetailSection
        ref={recordsRef}
        title="Source records"
        collapsible
        opened={state.recordsOpen}
        onOpenedChange={(recordsOpen) => {
          change({ recordsOpen });
        }}
        actions={
          <Button
            variant="subtle"
            size="xs"
            onClick={() => {
              revealSection(amountsRef.current);
            }}
          >
            Back to amounts
          </Button>
        }
      >
        <FinancialReviewRecords {...sourceProps} />
      </DetailSection>
    </>
  );
}
