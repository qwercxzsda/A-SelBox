import { useEffect } from "react";
import { Drawer } from "@mantine/core";
import { asReviewReason, asSelboxGroup } from "./api/financial-review";
import { decodeFinancialSourceSelection } from "./api/financial-source";
import { isJsonObject } from "./api/validation";
import type { Identity } from "./auth-session";
import { formatRecordMonth } from "./date-display";
import { decodeDetailPage } from "./detail-view-state";
import { DetailDrawer } from "./DetailDrawer";
import { DetailSection } from "./DetailSection";
import type { ReviewYear } from "./financial-review-model";
import { selectionFor, type ReviewSelection } from "./financial-review-view";
import type { OpenedOutcome } from "./FinancialReviewOutcomeTable";
import { FinancialReviewBreakdown } from "./FinancialReviewBreakdown";
import { FinancialReviewMonthNavigation } from "./FinancialReviewMonthNavigation";
import { FinancialReviewTotals } from "./FinancialReviewTotals";
import { FinancialSourceRecord } from "./FinancialSourceRecord";
import { PayoutReadiness } from "./PayoutReadiness";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { useWorkspacePreference } from "./use-workspace-preference";

/**
 * List names: "<outcome>:<marketplace>:<month>:<reason or group>" for records and
 * "READINESS:<marketplace>:<month>" for payout readiness companies.
 */
function reviewLists(marketplace: string, { month, reason, selboxGroup }: ReviewSelection) {
  return {
    difference: `DIFFERENCE:${marketplace}:${month}:${reason ?? "all"}`,
    selbox: `SELBOX:${marketplace}:${month}:${selboxGroup ?? "all"}`,
    readiness: `READINESS:${marketplace}:${month}`,
  };
}

type ReviewLists = ReturnType<typeof reviewLists>;

/** Pages by list name. */
type ListPages = Record<string, number>;

function decodeListPages(value: unknown): ListPages {
  return isJsonObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([list, page]) => [list, decodeDetailPage(page)]),
      )
    : {};
}

/**
 * The open month's list pages. Another month, reason or group starts its lists on page 1, also
 * one seen before: leaving a list forgets its page. A reload keeps the open lists' pages.
 */
function useListPages({ difference, selbox, readiness }: ReviewLists) {
  const [pages, setPages, correctPages] = useWorkspacePreference<ListPages>(
    "financial-review:pages",
    () => ({}),
    decodeListPages,
  );
  const hasLeftList = Object.keys(pages).some(
    (list) => list !== difference && list !== selbox && list !== readiness,
  );
  useEffect(() => {
    if (!hasLeftList) return;
    const open = [difference, selbox, readiness];
    correctPages((current) =>
      Object.fromEntries(Object.entries(current).filter(([list]) => open.includes(list))),
    );
  }, [hasLeftList, difference, selbox, readiness, correctPages]);
  const page = (list: string) => ({
    pageIndex: pages[list] ?? 0,
    onPageChange: (pageIndex: number) => {
      setPages((current) => ({ ...current, [list]: pageIndex }));
    },
  });
  return { difference: page(difference), selbox: page(selbox), readiness: page(readiness) };
}

/** An opened record and the records list that opened it. */
interface OpenedRecord extends OpenedOutcome {
  list: string;
}

function decodeOpenedRecord(value: unknown): OpenedRecord | null {
  if (!isJsonObject(value) || typeof value.key !== "string" || typeof value.list !== "string")
    return null;
  const source = decodeFinancialSourceSelection(value.source);
  return source ? { key: value.key, list: value.list, source } : null;
}

/**
 * The opened record belongs to its list: when that list closes (another month, reason or group,
 * Back, or a link) the record closes too and does not reopen over another list.
 */
function useOpenedRecord(lists: ReviewLists) {
  const [record, setRecord, correctRecord] = useWorkspacePreference(
    "financial-review:source-record",
    () => null,
    decodeOpenedRecord,
  );
  const listOpen = record?.list === lists.difference || record?.list === lists.selbox;
  useEffect(() => {
    if (record !== null && !listOpen) correctRecord(null);
  }, [record, listOpen, correctRecord]);
  return [listOpen ? record : null, setRecord] as const;
}

/** One month of the review: totals, differences, SelBox types and payout readiness. */
export function FinancialReviewMonthDetail({
  identity,
  marketplace,
  review,
  selection,
  onSelect,
  onClose,
  onExitTransitionEnd,
}: {
  identity: Identity;
  /** The selected marketplace, known before its year loads. */
  marketplace: string;
  /** The loaded year; the drawer opens only for one of its months. */
  review: ReviewYear | null;
  selection: ReviewSelection;
  onSelect: (selection: ReviewSelection) => void;
  onClose: () => void;
  onExitTransitionEnd: () => void;
}) {
  const months = review?.months ?? [];
  const index = months.findIndex(({ month }) => month === selection.month);
  const month = index >= 0 ? months[index] : null;
  const lists = reviewLists(marketplace, selection);
  const [record, setRecord] = useOpenedRecord(lists);
  const recordFocus = useDrawerFocusReturn({ opened: record !== null });
  const listPages = useListPages(lists);
  const label = month ? formatRecordMonth(month.month) : "";
  function recordOpener(list: string) {
    return (opened: OpenedOutcome) => {
      recordFocus.rememberOpener();
      setRecord({ ...opened, list });
    };
  }
  function step(target: string) {
    onSelect(
      selectionFor(
        months.find(({ month: candidate }) => candidate === target),
        selection,
      ),
    );
  }
  return (
    <Drawer.Stack>
      <DetailDrawer
        stackId="financial-review-month"
        opened={month !== null}
        title={label}
        context={review ? `${review.marketplace} · ${review.currency}` : ""}
        closeLabel={`Close ${label}`}
        headerActions={
          month && review ? (
            <FinancialReviewMonthNavigation
              year={review.year}
              previous={index > 0 ? months.at(index - 1)?.month : undefined}
              next={months.at(index + 1)?.month}
              onStep={step}
            />
          ) : null
        }
        width="wide"
        onClose={() => {
          setRecord(null);
          onClose();
        }}
        onExitTransitionEnd={onExitTransitionEnd}
      >
        {month && review ? (
          <>
            {/* The month's facts lead the drawer, like the field cards of other drawers. */}
            <FinancialReviewTotals
              label={`${label} totals`}
              totals={month.totals}
              currency={review.currency}
            />
            <FinancialReviewBreakdown
              identity={identity}
              outcome="DIFFERENCE"
              marketplace={review.marketplace}
              month={month.month}
              monthLabel={label}
              currency={review.currency}
              breakdowns={month.reasons}
              selected={selection.reason}
              onSelect={(code) => {
                onSelect({ ...selection, reason: asReviewReason(code) });
              }}
              {...listPages.difference}
              openedKey={record?.key ?? null}
              onOpenRecord={recordOpener(lists.difference)}
            />
            <FinancialReviewBreakdown
              identity={identity}
              outcome="SELBOX"
              marketplace={review.marketplace}
              month={month.month}
              monthLabel={label}
              currency={review.currency}
              breakdowns={month.groups}
              selected={selection.selboxGroup}
              onSelect={(code) => {
                onSelect({ ...selection, selboxGroup: asSelboxGroup(code) });
              }}
              {...listPages.selbox}
              collapsible
              openedKey={record?.key ?? null}
              onOpenRecord={recordOpener(lists.selbox)}
            />
            <DetailSection
              title="Payout readiness"
              collapsible
              stateKey="financial-review:payout-readiness"
              help="Readiness covers every marketplace for each company."
            >
              {/* Keyed: each month reads its own expanded companies. */}
              <PayoutReadiness
                key={month.month}
                identity={identity}
                month={month.month}
                {...listPages.readiness}
              />
            </DetailSection>
          </>
        ) : null}
      </DetailDrawer>
      <FinancialSourceRecord
        identity={identity}
        selection={month ? (record?.source ?? null) : null}
        stacked
        onClose={() => {
          setRecord(null);
        }}
        onExitTransitionEnd={recordFocus.restoreFocus}
      />
    </Drawer.Stack>
  );
}
