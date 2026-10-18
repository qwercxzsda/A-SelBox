import { useId, useRef } from "react";
import { Text, Title, UnstyledButton } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { FinancialReviewRecords } from "./FinancialReviewRecords";
import { FinancialReviewTypes } from "./FinancialReviewTypes";
import {
  createReviewSourceState,
  decodeReviewSourceState,
  type ReviewSourceState,
  type FinancialReviewSourceProps,
} from "./financial-review-source-state";
import { useWorkspacePreference } from "./use-workspace-preference";
import { FinancialReviewFamilies } from "./FinancialReviewFamilies";
import { DetailSection } from "./DetailSection";

export function FinancialReviewSourceDetails({
  identity,
  category,
  month,
  matureCutoff,
  currency,
  total,
}: Omit<FinancialReviewSourceProps, "state" | "change"> & { total: CanonicalRow }) {
  const [state, setSaved] = useWorkspacePreference(
    `financial-review:sources:${category}:${month}:${currency}`,
    createReviewSourceState,
    decodeReviewSourceState,
  );
  const recordsRef = useRef<HTMLElement>(null);
  const recordsId = useId();
  function change(patch: Partial<ReviewSourceState>) {
    setSaved({ ...state, ...patch });
  }
  const props = { identity, category, month, matureCutoff, currency, state, change };
  return (
    <>
      <Text size="xs" c="dimmed" mt="lg" mb="sm">
        {currency} · Finances: {total.finances_row_count ?? "0"} records · Data Kiosk:{" "}
        {total.data_kiosk_row_count ?? "0"} records
      </Text>
      <DetailSection
        stateKey={`financial-review:families:${category}:${month}:${currency}`}
        title="Fee family comparison"
        collapsible
      >
        <FinancialReviewFamilies
          identity={identity}
          category={category}
          month={month}
          matureCutoff={matureCutoff}
          currency={currency}
        />
      </DetailSection>
      <section className="detail-section" aria-label="Amounts by type">
        <Title order={4} className="detail-section-title" mb="sm">
          Amounts by type
        </Title>
        <Text size="xs" c="dimmed" mb="sm">
          Select a type to inspect its exact source records for this category, month and currency.
        </Text>
        <FinancialReviewTypes
          {...props}
          onSelect={() => {
            requestAnimationFrame(() => {
              recordsRef.current?.focus({ preventScroll: true });
              recordsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
            });
          }}
        />
      </section>
      <section
        className="detail-section"
        ref={recordsRef}
        tabIndex={-1}
        aria-label="Source records"
      >
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
        <div className="detail-section-body" id={recordsId} hidden={!state.recordsOpen}>
          {state.recordsOpen ? <FinancialReviewRecords {...props} /> : null}
        </div>
      </section>
    </>
  );
}
