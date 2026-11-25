import { useEffect, useId, useRef } from "react";
import { Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchReviewMonths } from "./api";
import type { ReviewReason } from "./api/financial-review";
import { marketplaceCurrency } from "./api/marketplace-currencies";
import type { Identity } from "./auth-session";
import { ErrorAlert } from "./ErrorAlert";
import { buildReviewYear } from "./financial-review-model";
import {
  CLOSED_REVIEW_MONTH,
  decodeFinancialReviewView,
  selectionFor,
  type FinancialReviewView,
} from "./financial-review-view";
import { FinancialReviewChart } from "./FinancialReviewChart";
import { FinancialReviewMonthDetail } from "./FinancialReviewMonthDetail";
import { FinancialReviewMonthTable } from "./FinancialReviewMonthTable";
import { FinancialReviewScope } from "./FinancialReviewScope";
import { FinancialReviewTotals } from "./FinancialReviewTotals";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { useWorkspacePreference } from "./use-workspace-preference";
import { loadErrorDetail } from "./load-error";
import { WorkspaceHeader } from "./WorkspaceHeader";
import "./FinancialReview.css";

export function FinancialReview({ identity }: { identity: Identity }) {
  return identity.account.access_role === "administrator" ? (
    <AdministratorFinancialReview identity={identity} />
  ) : null;
}

function ReviewHelp() {
  return (
    <>
      <p>
        Every Finances amount becomes a Company amount, a SelBox type or a Difference. A Difference
        cannot reach a company yet; its reason says why.
      </p>
      <p>Amounts include tax. Each month, Finances equals the other three added together.</p>
      <p>Select a month for its records and payout readiness.</p>
    </>
  );
}

/** One marketplace-year, checked month by month. Another scope's result stays dimmed until replaced. */
function useReviewYear(identity: Identity, { marketplace, year }: FinancialReviewView) {
  const userId = identity.session.user.id;
  return useQuery({
    queryKey: ["financial-review", userId, "months", marketplace, year],
    queryFn: async ({ signal }) =>
      buildReviewYear(
        await fetchReviewMonths(identity.session.access_token, { marketplace, year }, signal),
        { marketplace, year, currency: marketplaceCurrency(marketplace) },
      ),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === userId ? previous : undefined,
  });
}

function AdministratorFinancialReview({ identity }: { identity: Identity }) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const monthsTitle = useId();
  const [view, setView, correctView] = useWorkspacePreference(
    "financial-review:view",
    () => decodeFinancialReviewView(null),
    decodeFinancialReviewView,
  );
  const query = useReviewYear(identity, view);
  // A failed check never falls back to an earlier result.
  const review = query.isError ? null : (query.data ?? null);
  const placeholder = query.isPlaceholderData;
  const busy = placeholder || query.isPending;
  const loaded = placeholder ? null : review;
  const drawerFocus = useDrawerFocusReturn({
    opened: loaded?.months.some(({ month }) => month === view.month) ?? false,
    fallbackRef: scopeRef,
  });

  // A linked or restored month, reason or group that the loaded year lacks leaves the URL. The
  // correction replaces the history entry: Back from it must not return to the stale link.
  useEffect(() => {
    if (!loaded) return;
    const shown = selectionFor(
      loaded.months.find(({ month }) => month === view.month),
      view,
    );
    if (
      shown.month !== view.month ||
      shown.reason !== view.reason ||
      shown.selboxGroup !== view.selboxGroup
    )
      correctView((current) => ({ ...current, ...shown }));
  }, [loaded, view, correctView]);

  function openMonth(month: string, reason: ReviewReason | null = null) {
    drawerFocus.rememberOpener();
    setView((current) => ({ ...current, ...CLOSED_REVIEW_MONTH, month, reason }));
  }

  return (
    <div className="financial-review-panel">
      <WorkspaceHeader
        title="Financial review"
        status={query.isPending ? "loading" : query.isFetching ? "updating" : null}
        help={<ReviewHelp />}
      />
      <FinancialReviewScope
        ref={scopeRef}
        marketplace={view.marketplace}
        year={view.year}
        onChange={(patch) => {
          setView((current) => ({ ...current, ...patch, ...CLOSED_REVIEW_MONTH }));
        }}
      />
      {query.isError ? (
        <ErrorAlert
          title="Could not load Financial review"
          detail={loadErrorDetail(query.error)}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      <FinancialReviewTotals
        label={`${String(review?.year ?? view.year)} totals`}
        totals={review?.totals ?? null}
        currency={review?.currency ?? marketplaceCurrency(view.marketplace)}
        isPlaceholderData={placeholder}
        isBusy={busy}
      />
      <FinancialReviewChart
        review={review}
        isPlaceholderData={placeholder}
        isBusy={busy}
        onSelect={openMonth}
      />
      <section className="financial-review-months-section" aria-labelledby={monthsTitle}>
        <Title
          order={3}
          size="h4"
          className="detail-section-title financial-review-months-title"
          id={monthsTitle}
        >
          Months
        </Title>
        <FinancialReviewMonthTable
          review={review}
          selectedMonth={view.month}
          isPlaceholderData={placeholder}
          onSelectMonth={(month) => {
            openMonth(month);
          }}
        />
      </section>
      <FinancialReviewMonthDetail
        identity={identity}
        marketplace={view.marketplace}
        review={loaded}
        selection={view}
        onSelect={(selection) => {
          setView((current) => ({ ...current, ...selection }));
        }}
        onClose={() => {
          setView((current) => ({ ...current, ...CLOSED_REVIEW_MONTH }));
        }}
        onExitTransitionEnd={drawerFocus.restoreFocus}
      />
    </div>
  );
}
