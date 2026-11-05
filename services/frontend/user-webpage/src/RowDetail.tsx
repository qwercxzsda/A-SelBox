import "./RowDetail.css";
import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { Drawer } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { formatRecordMonth } from "./date-display";
import { DrawerHeading } from "./DrawerHeading";
import { RowDetailContent } from "./RowDetailContent";
import { payoutMarketplaceLabel } from "./payout-report-scope";

export function RowDetail({
  companies,
  dataset,
  row,
  onClose,
  isAdministrator,
  accessToken,
  reviewMode = false,
  reportNavigation,
  stackId,
  onExitTransitionEnd,
  fallbackContent = null,
  requestFeedback,
}: {
  companies: Map<string, string>;
  dataset: TableDatasetKey;
  row: CanonicalRow | null;
  onClose: () => void;
  isAdministrator: boolean;
  accessToken: string;
  reviewMode?: boolean;
  reportNavigation?: ReactNode;
  stackId?: string;
  onExitTransitionEnd?: () => void;
  fallbackContent?: ReactElement | null;
  requestFeedback?: ReactNode;
}) {
  const rowHeadingRef = useRef<HTMLHeadingElement>(null);
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
      (row ? rowHeadingRef.current : closeButtonRef.current)?.focus({ preventScroll: true });
  }, [row, hasFallback]);
  const isReview = dataset === "payouts" && reviewMode && isAdministrator;
  return (
    <Drawer
      stackId={stackId}
      onExitTransitionEnd={onExitTransitionEnd}
      id="selected-row-details"
      opened={row !== null || fallbackContent !== null}
      onClose={onClose}
      position="right"
      size={dataset === "payouts" ? "min(1440px, 100vw)" : "lg"}
      padding="lg"
      title={
        dataset === "payouts" && row ? (
          <DrawerHeading
            title={isReview ? "Saved source details" : "Selected row details"}
            context={`${companies.get(row.company_id ?? "") ?? "Company"} · ${formatRecordMonth(row.start_date ?? "")} · ${payoutMarketplaceLabel(row)}${row.currency ? ` · ${row.currency}` : ""}`}
          />
        ) : (
          "Selected row details"
        )
      }
      closeButtonProps={{ ref: closeButtonRef, "aria-label": "Close row details" }}
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
            isReview={isReview}
            reportNavigation={reportNavigation}
            headingRef={rowHeadingRef}
          />
        ) : (
          fallbackContent
        )}
      </div>
    </Drawer>
  );
}
