import { reviewPeriodKey } from "./financial-review-scope-key";
import { useId, useRef } from "react";
import { Button, Group, Text, Title, UnstyledButton } from "@mantine/core";
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
  identity,
  category,
  month,
  matureCutoff,
  currency,
  marketplace,
  families,
  total,
}: FinancialReviewMonthScope & { total: CanonicalRow }) {
  const [state, setSaved] = useWorkspacePreference(
    `financial-review:sources:${category}:${reviewPeriodKey(month, marketplace, currency)}${reviewFamilyStateKey(families)}`,
    createReviewSourceState,
    decodeReviewSourceState,
  );
  const amountsRef = useRef<HTMLElement>(null);
  const recordsRef = useRef<HTMLElement>(null);
  const recordsId = useId();
  function change(patch: Partial<ReviewSourceState>) {
    setSaved((current) => ({ ...current, ...patch }));
  }
  const props = {
    identity,
    category,
    month,
    matureCutoff,
    currency,
    marketplace,
    families,
    state,
    change,
  };
  return (
    <>
      <Text size="xs" c="dimmed" mt="lg" mb="sm">
        {marketplace} · Records in {currency} · Finances:{" "}
        {total.finances_row_count ?? "Unavailable"} · Data Kiosk:{" "}
        {total.data_kiosk_row_count ?? "Unavailable"}
      </Text>
      <DetailSection
        stateKey={`financial-review:families:${category}:${reviewPeriodKey(month, marketplace, currency)}`}
        title="Fee family comparison"
        collapsible
      >
        <FinancialReviewFamilies
          identity={identity}
          category={category}
          month={month}
          matureCutoff={matureCutoff}
          currency={currency}
          marketplace={marketplace}
          families={families}
        />
      </DetailSection>
      <DetailSection
        ref={amountsRef}
        title="Amounts by type"
        description="Select a type to inspect its exact source records for this marketplace, category, month and currency."
      >
        <FinancialReviewTypes
          {...props}
          onSelect={() => {
            requestAnimationFrame(() => {
              revealSection(recordsRef.current);
            });
          }}
        />
      </DetailSection>
      <section
        className="detail-section"
        ref={recordsRef}
        tabIndex={-1}
        aria-label="Source records"
      >
        <Group className="detail-section-header" justify="space-between" gap="sm">
          <Title order={4} className="detail-section-title">
            <UnstyledButton
              className="detail-section-toggle ui-text-action"
              aria-expanded={state.recordsOpen}
              aria-controls={recordsId}
              onClick={() => {
                change({ recordsOpen: !state.recordsOpen });
              }}
            >
              Source records <span aria-hidden="true">{state.recordsOpen ? "⌃" : "⌄"}</span>
            </UnstyledButton>
          </Title>
          {state.recordsOpen ? (
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                revealSection(amountsRef.current);
              }}
            >
              Back to amounts
            </Button>
          ) : null}
        </Group>
        <div className="detail-section-body" id={recordsId} hidden={!state.recordsOpen}>
          {state.recordsOpen ? <FinancialReviewRecords {...props} /> : null}
        </div>
      </section>
    </>
  );
}
