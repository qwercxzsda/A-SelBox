import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import type { CanonicalRow, RawReportKey, TableDatasetKey } from "./api";
import { sourceCodeLabel } from "./categories";
import { formatRecordDay, formatRecordMonth } from "./date-display";
import { DetailDrawer } from "./DetailDrawer";
import { RowDetailContent } from "./RowDetailContent";
import { payoutMarketplaceLabel } from "./payout-report-scope";

/** Amazon report rows open RawRecordDrawer instead. */
type RecordDataset = Exclude<TableDatasetKey, RawReportKey>;

const TITLES: Record<RecordDataset, string> = {
  live: "Transaction details",
  finances: "Finances record details",
  payouts: "Payout report details",
  accounts: "User access details",
};

/** "identity · scope" for the drawer heading. */
function rowContext(dataset: TableDatasetKey, row: CanonicalRow, companies: Map<string, string>) {
  if (dataset === "payouts")
    return [
      companies.get(row.company_id ?? "") ?? "Company",
      formatRecordMonth(row.start_date ?? ""),
      payoutMarketplaceLabel(row),
      row.currency,
    ]
      .filter(Boolean)
      .join(" · ");
  const day = row.activity_at ?? row.activity_date ?? row.posted_date;
  return [
    row.sku ?? (row.component_type ? sourceCodeLabel(row.component_type) : null),
    row.marketplace_name,
    day ? formatRecordDay(day) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RowDetail({
  companies,
  dataset,
  row,
  onClose,
  isAdministrator,
  accessToken,
  reportNavigation,
  stackId,
  onExitTransitionEnd,
  onShowTransactions,
  fallbackContent = null,
  requestFeedback,
}: {
  companies: Map<string, string>;
  dataset: RecordDataset;
  row: CanonicalRow | null;
  onClose: () => void;
  isAdministrator: boolean;
  accessToken: string;
  reportNavigation?: ReactNode;
  stackId?: string;
  onExitTransitionEnd?: () => void;
  onShowTransactions?: (sku: string) => void;
  fallbackContent?: ReactElement | null;
  requestFeedback?: ReactNode;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const hasFallback = fallbackContent !== null;
  useLayoutEffect(() => {
    if (!row && !hasFallback) {
      lastFocused.current = null;
      return;
    }
    const active = document.activeElement;
    // Refresh can replace feedback with a record, or a removed record with feedback.
    // Recover only focus lost with that content, without interrupting another control.
    if (
      lastFocused.current &&
      !lastFocused.current.isConnected &&
      (active === document.body || active === document.documentElement)
    )
      (row ? titleRef.current : closeButtonRef.current)?.focus({ preventScroll: true });
  }, [row, hasFallback]);
  return (
    <DetailDrawer
      stackId={stackId}
      onExitTransitionEnd={onExitTransitionEnd}
      id="selected-row-details"
      opened={row !== null || fallbackContent !== null}
      onClose={onClose}
      width={dataset === "payouts" ? "full" : "record"}
      title={TITLES[dataset]}
      context={row ? rowContext(dataset, row, companies) : ""}
      titleRef={titleRef}
      closeButtonRef={closeButtonRef}
    >
      <div
        role="group"
        aria-label="Record details"
        onFocusCapture={(event) => {
          lastFocused.current = event.target;
        }}
      >
        {requestFeedback}
        {row ? (
          <RowDetailContent
            companies={companies}
            dataset={dataset}
            row={row}
            isAdministrator={isAdministrator}
            accessToken={accessToken}
            reportNavigation={reportNavigation}
            onShowTransactions={onShowTransactions}
          />
        ) : (
          fallbackContent
        )}
      </div>
    </DetailDrawer>
  );
}
