import { Button, Group, Text } from "@mantine/core";
import { DETAIL_PAGE_SIZE } from "./api/pagination";

export interface DetailPaginationState {
  pageIndex: number;
  totalCount: number | null;
  onPageChange: (page: number) => void;
}

export function DetailPagination({
  pagination,
  label,
  rowCount,
  disabled,
  bottom = false,
}: {
  pagination: DetailPaginationState;
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
