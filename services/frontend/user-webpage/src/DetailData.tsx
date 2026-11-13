import { useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { LoadingStatus } from "./LoadingStatus";
import { lastPageIndex } from "./pagination";
import { DetailPagination, type DetailPaginationState } from "./DetailPagination";
import { revealSection } from "./reveal-section";

interface DetailQuery {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
}

/** Identical request feedback and pagination for every report detail section. */
export function DetailData({
  query,
  label,
  rowCount,
  emptyMessage,
  pagination,
  children,
}: {
  query: DetailQuery;
  label: string;
  rowCount: number;
  emptyMessage: string;
  pagination?: DetailPaginationState;
  children?: ReactNode;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const { pageIndex, totalCount, onPageChange } = pagination ?? {};
  useEffect(() => {
    if (
      !query.isSuccess ||
      pageIndex === undefined ||
      totalCount === undefined ||
      totalCount === null
    )
      return;
    const finalPage = lastPageIndex(totalCount, DETAIL_PAGE_SIZE);
    if (pageIndex > finalPage) {
      const active = document.activeElement;
      if (
        (active === document.body || active === document.documentElement) &&
        lastFocused.current &&
        !lastFocused.current.isConnected
      ) {
        sectionRef.current?.focus({ preventScroll: true });
      }
      onPageChange?.(finalPage);
    }
  }, [query.isSuccess, pageIndex, totalCount, onPageChange]);
  const visiblePagination =
    pagination && query.isSuccess && (rowCount > 0 || pagination.pageIndex > 0) ? pagination : null;
  function focusResults() {
    sectionRef.current?.focus({ preventScroll: true });
  }
  function changePage(page: number) {
    revealSection(sectionRef.current);
    pagination?.onPageChange(page);
  }
  return (
    <div
      ref={sectionRef}
      className="detail-data"
      role="group"
      aria-label={label}
      tabIndex={-1}
      onFocusCapture={(event) => {
        lastFocused.current = event.target;
      }}
    >
      {query.isPending ? (
        <Text className="detail-data-message" role="status">
          Loading {label}…
        </Text>
      ) : null}
      {!visiblePagination && query.isFetching && !query.isPending ? (
        <LoadingStatus state="updating" />
      ) : null}
      {query.isError ? (
        <Alert role="alert" color="red" mb="sm">
          <Group justify="space-between" gap="sm">
            <span>Could not load {label}.</span>
            <Button
              variant="subtle"
              size="xs"
              color="red"
              aria-label={`Retry ${label}`}
              onClick={() => {
                focusResults();
                void query.refetch();
              }}
            >
              Retry
            </Button>
          </Group>
        </Alert>
      ) : null}
      {query.isSuccess && rowCount === 0 ? (
        <Text className="detail-data-message" role="status">
          {emptyMessage}
        </Text>
      ) : null}
      {visiblePagination ? (
        <DetailPagination
          pagination={{ ...visiblePagination, onPageChange: changePage }}
          label={label}
          rowCount={rowCount}
          disabled={query.isFetching}
        />
      ) : null}
      {children}
      {visiblePagination && rowCount > 10 ? (
        <DetailPagination
          pagination={{ ...visiblePagination, onPageChange: changePage }}
          label={label}
          rowCount={rowCount}
          disabled={query.isFetching}
          bottom
        />
      ) : null}
    </div>
  );
}
