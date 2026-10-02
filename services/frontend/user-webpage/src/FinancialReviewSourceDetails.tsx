import { useId, useRef } from "react";
import { Group, NativeSelect, Text, Title, UnstyledButton } from "@mantine/core";
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

export function FinancialReviewSourceDetails({
  identity,
  category,
  month,
  matureCutoff,
  totals,
}: Omit<FinancialReviewSourceProps, "currency" | "state" | "change"> & { totals: CanonicalRow[] }) {
  const [saved, setSaved] = useWorkspacePreference(
    `financial-review:sources:${category}:${month}`,
    createReviewSourceState,
    decodeReviewSourceState,
  );
  const state = totals.some((row) => row.currency === saved.currency)
    ? saved
    : { ...createReviewSourceState(), currency: totals[0]?.currency ?? "" };
  const currency = state.currency;
  const recordsRef = useRef<HTMLElement>(null);
  const recordsId = useId();
  const selected = totals.find((row) => row.currency === currency);
  if (!currency) return null;
  function change(patch: Partial<ReviewSourceState>) {
    setSaved({ ...state, ...patch });
  }
  const props = { identity, category, month, matureCutoff, currency, state, change };
  return (
    <>
      <Group mt="lg" mb="sm" align="end" gap="md">
        <NativeSelect
          label="Review currency"
          value={currency}
          data={totals.map((row) => row.currency ?? "")}
          onChange={(event) => {
            setSaved({
              ...createReviewSourceState(),
              currency: event.currentTarget.value,
              recordsOpen: state.recordsOpen,
            });
          }}
        />
        <Text size="xs" c="dimmed">
          Settlement: {selected?.settlement_row_count ?? "0"} records · Data Kiosk:{" "}
          {selected?.data_kiosk_row_count ?? "0"} records
        </Text>
      </Group>
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
            className="detail-section-toggle"
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
