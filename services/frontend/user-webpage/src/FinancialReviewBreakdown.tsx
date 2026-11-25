import { Text } from "@mantine/core";
import { asReviewReason, asSelboxGroup, type ReviewOutcome } from "./api/financial-review";
import type { Identity } from "./auth-session";
import { DetailSection } from "./DetailSection";
import { decodeDetailOpen } from "./detail-view-state";
import type { ReviewBreakdown } from "./financial-review-model";
import type { OpenedOutcome } from "./FinancialReviewOutcomeTable";
import { FinancialReviewCodeTable, type ReviewCode } from "./FinancialReviewCodeTable";
import { FinancialReviewRecords } from "./FinancialReviewRecords";
import { useWorkspacePreference } from "./use-workspace-preference";

const COPY: Record<
  ReviewOutcome,
  {
    title: string;
    code: string;
    table: string;
    recordsTable: string;
    records: string;
    empty: string;
  }
> = {
  DIFFERENCE: {
    title: "Differences",
    code: "Reason",
    table: "Differences by reason",
    recordsTable: "Difference records",
    records: "difference records",
    empty: "No differences",
  },
  SELBOX: {
    title: "SelBox types",
    code: "Group",
    table: "SelBox types by group",
    recordsTable: "SelBox type records",
    records: "SelBox type records",
    empty: "No SelBox types",
  },
};

/**
 * A collapsible section opens while one of its codes is selected, so a linked group shows.
 * Collapsing it clears the selection, so the URL never names a hidden group.
 */
function useSectionOpen(outcome: ReviewOutcome, selected: boolean, onClear: () => void) {
  const [saved, setSaved] = useWorkspacePreference(
    `financial-review:${outcome}:expanded`,
    () => false,
    decodeDetailOpen,
  );
  return {
    opened: saved || selected,
    onOpenedChange: (opened: boolean) => {
      setSaved(opened);
      if (!opened) onClear();
    },
  };
}

/** A month's differences by reason or SelBox types by group; a selected code narrows the records. */
export function FinancialReviewBreakdown({
  identity,
  outcome,
  marketplace,
  month,
  monthLabel,
  currency,
  breakdowns,
  selected,
  onSelect,
  pageIndex,
  onPageChange,
  collapsible = false,
  openedKey,
  onOpenRecord,
}: {
  identity: Identity;
  outcome: ReviewOutcome;
  marketplace: string;
  month: string;
  monthLabel: string;
  currency: string;
  breakdowns: readonly ReviewBreakdown<ReviewCode>[];
  selected: ReviewCode | null;
  onSelect: (code: ReviewCode | null) => void;
  /** The records page. */
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
  collapsible?: boolean;
  openedKey: string | null;
  onOpenRecord: (opened: OpenedOutcome) => void;
}) {
  const copy = COPY[outcome];
  const selection = breakdowns.find(({ code }) => code === selected) ?? null;
  const totalCount = selection
    ? selection.count
    : breakdowns.reduce((total, { count }) => total + count, 0);
  const section = useSectionOpen(outcome, selection !== null, () => {
    onSelect(null);
  });
  return (
    <DetailSection
      title={copy.title}
      collapsible={collapsible}
      stateKey={`financial-review:${outcome}`}
      {...(collapsible ? section : {})}
    >
      {breakdowns.length ? (
        <>
          <FinancialReviewCodeTable
            label={copy.table}
            codeName={copy.code}
            breakdowns={breakdowns}
            selected={selection?.code ?? null}
            currency={currency}
            onSelect={onSelect}
          />
          <FinancialReviewRecords
            identity={identity}
            filters={{
              outcome,
              marketplace,
              month,
              reason: outcome === "DIFFERENCE" ? asReviewReason(selection?.code) : null,
              selboxGroup: outcome === "SELBOX" ? asSelboxGroup(selection?.code) : null,
            }}
            pageIndex={pageIndex}
            onPageChange={onPageChange}
            totalCount={totalCount}
            currency={currency}
            label={copy.recordsTable}
            items={copy.records}
            openedKey={openedKey}
            onOpenRecord={onOpenRecord}
          />
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {copy.empty} in {monthLabel}.
        </Text>
      )}
    </DetailSection>
  );
}
