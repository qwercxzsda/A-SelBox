import { useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { UpdateStatus } from "./UpdateStatus";
import { lastPageIndex } from "./pagination";

interface DetailQuery {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
}

interface DetailPagination {
  pageIndex: number;
  totalCount: number | null;
  onPageChange: (page: number) => void;
}

function DetailPager({
  pagination,
  label,
  rowCount,
  disabled,
  bottom = false,
}: {
  pagination: DetailPagination;
  label: string;
  rowCount: number;
  disabled: boolean;
  bottom?: boolean;
}) {
  const { pageIndex, totalCount, onPageChange } = pagination;
  const hasNext =
    totalCount === null
      ? rowCount === DETAIL_PAGE_SIZE
      : (pageIndex + 1) * DETAIL_PAGE_SIZE < totalCount;
  const first = pageIndex * DETAIL_PAGE_SIZE + 1;
  const range = `${first.toLocaleString("en-US")}–${(first + rowCount - 1).toLocaleString("en-US")}`;
  const position = bottom ? " at bottom" : "";
  return (
    <Group
      component="nav"
      aria-label={`Pagination for ${label}${position}`}
      className="detail-pagination"
      data-position={bottom ? "bottom" : "top"}
      justify="space-between"
      gap="sm"
    >
      <Text size="xs" c="dimmed" aria-live={bottom ? undefined : "polite"}>
        {bottom ? `Records ${range}` : `Page ${String(pageIndex + 1)}`}
        {totalCount !== null ? ` · ${totalCount.toLocaleString("en-US")} records` : ""}
      </Text>
      <Group gap="xs">
        <Button
          variant="default"
          size="xs"
          aria-label={`Previous ${label}${position}`}
          disabled={pageIndex === 0 || disabled}
          onClick={() => {
            onPageChange(pageIndex - 1);
          }}
        >
          Previous
        </Button>
        <Button
          variant="default"
          size="xs"
          aria-label={`Next ${label}${position}`}
          disabled={!hasNext || disabled}
          onClick={() => {
            onPageChange(pageIndex + 1);
          }}
        >
          Next
        </Button>
      </Group>
    </Group>
  );
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
  pagination?: DetailPagination;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
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
    if (pageIndex > finalPage) onPageChange?.(finalPage);
  }, [query.isSuccess, pageIndex, totalCount, onPageChange]);
  const visiblePagination =
    pagination && query.isSuccess && (rowCount > 0 || pagination.pageIndex > 0) ? pagination : null;
  function changePage(page: number) {
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    pagination?.onPageChange(page);
  }
  return (
    <div ref={sectionRef} className="detail-data">
      {query.isPending ? (
        <Text className="detail-data-message" role="status">
          Loading {label}…
        </Text>
      ) : null}
      <UpdateStatus
        active={query.isFetching && !query.isPending}
      >{`Updating ${label}…`}</UpdateStatus>
      {query.isError ? (
        <Alert role="alert" color="red" mb="sm">
          <Group justify="space-between" gap="sm">
            <span>Could not load {label}.</span>
            <Button
              variant="subtle"
              size="xs"
              color="red"
              aria-label={`Retry ${label}`}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </Group>
        </Alert>
      ) : null}
      {query.isSuccess && rowCount === 0 ? (
        <Text className="detail-data-message">{emptyMessage}</Text>
      ) : null}
      {visiblePagination ? (
        <DetailPager
          pagination={{ ...visiblePagination, onPageChange: changePage }}
          label={label}
          rowCount={rowCount}
          disabled={query.isFetching}
        />
      ) : null}
      {children}
      {visiblePagination && rowCount > 10 ? (
        <DetailPager
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
