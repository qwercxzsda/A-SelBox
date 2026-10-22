import "./PaginationBar.css";
import { useState } from "react";
import { Button, Group, NumberInput, Text } from "@mantine/core";

interface PaginationBarProps {
  pageIndex: number;
  pageCount: number | null;
  canPrevious: boolean;
  canNext: boolean;
  isBusy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageChange?: (pageIndex: number) => void;
  summary: string;
  ariaLabel?: string;
}

/** Keep focus on an unavailable step without allowing another page request. */
function PaginationStepButton({
  label,
  disabled,
  onClick,
}: {
  label: "Previous" | "Next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="default"
      aria-disabled={disabled}
      data-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {label}
    </Button>
  );
}

export function PaginationBar({
  pageIndex,
  pageCount,
  canPrevious,
  canNext,
  isBusy = false,
  onPrevious,
  onNext,
  onPageChange,
  summary,
  ariaLabel = "Pagination",
}: PaginationBarProps) {
  const [previousPageIndex, setPreviousPageIndex] = useState(pageIndex);
  const [draftPage, setDraftPage] = useState<string | number>(pageIndex + 1);
  const pageLabel = `Page ${String(pageIndex + 1)} of ${pageCount === null ? "—" : String(pageCount)}`;
  const hasPageDraft = String(draftPage) !== String(pageIndex + 1);

  if (previousPageIndex !== pageIndex) {
    setPreviousPageIndex(pageIndex);
    setDraftPage(pageIndex + 1);
  }

  function commitPage() {
    if (isBusy) return;
    const value = Number(draftPage);
    if (!onPageChange || pageCount === null || draftPage === "" || !Number.isFinite(value)) {
      setDraftPage(pageIndex + 1);
      return;
    }
    const nextPage = Math.min(Math.max(1, Math.trunc(value)), Math.max(1, pageCount));
    setDraftPage(nextPage);
    if (nextPage - 1 !== pageIndex) onPageChange(nextPage - 1);
  }

  return (
    <Group
      component="nav"
      className="pagination-bar"
      justify="space-between"
      aria-label={ariaLabel}
    >
      <Text className="pagination-summary" size="sm" c="dimmed">
        {summary}
      </Text>
      <div className="pagination-controls">
        <PaginationStepButton
          label="Previous"
          disabled={!canPrevious || isBusy}
          onClick={onPrevious}
        />
        <form
          className="pagination-current"
          aria-label={pageLabel}
          onSubmit={(event) => {
            event.preventDefault();
            commitPage();
          }}
        >
          <span className="pagination-page-label">Page</span>
          <NumberInput
            className="pagination-input"
            aria-label="Page number"
            enterKeyHint="go"
            hideControls
            allowDecimal={false}
            allowNegative={false}
            clampBehavior="none"
            min={1}
            max={pageCount ?? undefined}
            value={draftPage}
            // Drawer Escape handlers run during capture; cancel this edit before closing a drawer.
            data-mantine-stop-propagation={hasPageDraft || undefined}
            onChange={setDraftPage}
            readOnly={isBusy || !onPageChange || pageCount === null}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraftPage(pageIndex + 1);
              }
            }}
          />
          <span>of {pageCount ?? "—"}</span>
        </form>
        <PaginationStepButton label="Next" disabled={!canNext || isBusy} onClick={onNext} />
      </div>
    </Group>
  );
}
