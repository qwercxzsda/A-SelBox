import type { ReactNode } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PageResult } from "./api/types";
import { PAYOUT_DETAIL_PAGE_SIZE } from "./api/payouts";

/** Shared loading, retry, and pagination for immutable report details. */
export function PayoutDetailPage({
  query,
  pageIndex,
  onPageChange,
  label,
  emptyMessage,
  children,
}: {
  query: UseQueryResult<PageResult>;
  pageIndex: number;
  onPageChange: (page: number) => void;
  label: "details" | "reconciliation";
  emptyMessage: string;
  children: ReactNode;
}) {
  const rowCount = query.data?.rows.length ?? 0;
  const total = query.data?.totalCount ?? null;
  const hasNext =
    total === null
      ? rowCount === PAYOUT_DETAIL_PAGE_SIZE
      : (pageIndex + 1) * PAYOUT_DETAIL_PAGE_SIZE < total;
  return (
    <>
      {query.isPending ? <Text role="status">Loading {label}…</Text> : null}
      {query.isError ? (
        <Alert role="alert" color="red">
          Could not load {label}.
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry {label}
          </Button>
        </Alert>
      ) : null}
      {query.isSuccess && rowCount === 0 ? <Text>{emptyMessage}</Text> : null}
      {children}
      <Group mt="sm">
        <Button
          size="xs"
          variant="default"
          disabled={pageIndex === 0 || query.isFetching}
          onClick={() => {
            onPageChange(pageIndex - 1);
          }}
        >
          Previous {label}
        </Button>
        <Text size="sm">Page {pageIndex + 1}</Text>
        <Button
          size="xs"
          variant="default"
          disabled={!hasNext || query.isFetching}
          onClick={() => {
            onPageChange(pageIndex + 1);
          }}
        >
          Next {label}
        </Button>
      </Group>
    </>
  );
}
