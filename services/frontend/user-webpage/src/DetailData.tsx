import { useEffect, useRef, type ReactNode } from "react";
import { Text } from "@mantine/core";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";
import { LoadingStatus } from "./LoadingStatus";
import { lastPageIndex } from "./pagination";
import { DetailPagination, type DetailPaginationState } from "./DetailPagination";
import { revealSection } from "./reveal-section";
import { drawerScroller, useScrollReserve } from "./scroll-reserve";

interface DetailQuery {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
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
  // A shorter result (another reason, group or page) keeps the drawer where it is.
  useScrollReserve(sectionRef, drawerScroller);
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
  /** Paging keeps focus on the list; only the pager below the rows scrolls to its start. */
  function changePage(page: number, fromBottom: boolean) {
    if (fromBottom) revealSection(sectionRef.current);
    else focusResults();
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
        <ErrorAlert
          title={`Could not load ${label}`}
          detail={loadErrorDetail(query.error)}
          retrying={query.isFetching}
          onRetry={() => {
            focusResults();
            void query.refetch();
          }}
        />
      ) : null}
      {query.isSuccess && rowCount === 0 ? (
        <Text className="detail-data-message" role="status">
          {emptyMessage}
        </Text>
      ) : null}
      {visiblePagination ? (
        <DetailPagination
          pagination={{
            ...visiblePagination,
            onPageChange: (page) => {
              changePage(page, false);
            },
          }}
          label={label}
          rowCount={rowCount}
          disabled={query.isFetching}
        />
      ) : null}
      {children}
      {visiblePagination && rowCount > 10 ? (
        <DetailPagination
          pagination={{
            ...visiblePagination,
            onPageChange: (page) => {
              changePage(page, true);
            },
          }}
          label={label}
          rowCount={rowCount}
          disabled={query.isFetching}
          bottom
        />
      ) : null}
    </div>
  );
}
