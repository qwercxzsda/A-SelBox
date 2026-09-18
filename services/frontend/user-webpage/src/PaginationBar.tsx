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
}: PaginationBarProps) {
  const [previousPageIndex, setPreviousPageIndex] = useState(pageIndex);
  const [draftPage, setDraftPage] = useState<string | number>(pageIndex + 1);
  const pageLabel = `Page ${String(pageIndex + 1)} of ${pageCount === null ? "—" : String(pageCount)}`;

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
      aria-label="Pagination"
    >
      <Text className="pagination-summary" size="sm" c="dimmed">
        {summary}
      </Text>
      <div className="pagination-controls">
        <Button variant="default" disabled={!canPrevious || isBusy} onClick={onPrevious}>
          Previous
        </Button>
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
        <Button variant="default" disabled={!canNext || isBusy} onClick={onNext}>
          Next
        </Button>
      </div>
    </Group>
  );
}
