import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Group, Table, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import type { Identity } from "./auth-session";
import { formatRecordDate } from "./date-display";
import { formatExactMoney } from "./decimal";
import { getErrorMessage, rowId } from "./view-model";
import { PaginationBar } from "./PaginationBar";
import { UpdateStatus } from "./UpdateStatus";
import { payoutVersionSelection } from "./payout-report-view";
import { payoutHistoryQueryOptions } from "./payout-report-queries";

export function PayoutReportHistory({
  identity,
  latest,
  label,
  pageIndex,
  onPageChange,
  onSelect,
}: {
  identity: Identity;
  latest: CanonicalRow;
  label: string;
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
  onSelect: (row: CanonicalRow) => void;
}) {
  const currency = latest.currency;
  const query = useQuery(
    payoutHistoryQueryOptions(identity, payoutVersionSelection(latest), pageIndex),
  );
  const rows = query.data?.rows ?? [];
  const total = query.data?.totalCount ?? null;
  const pageCount = total === null ? null : Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));
  useEffect(() => {
    if (pageCount !== null && pageIndex >= pageCount) onPageChange(pageCount - 1);
  }, [pageCount, pageIndex, onPageChange]);

  return (
    <section className="payout-report-history" aria-label={`Report versions for ${label}`}>
      <Group justify="space-between" gap="xs" mb="xs">
        <div>
          <Text fw={600} size="sm">
            Report versions
          </Text>
          <Text size="xs" c="dimmed">
            {label}. Open a version to inspect its saved amounts and records.
          </Text>
        </div>
        <UpdateStatus active={query.isFetching && !query.isPending}>
          Updating versions…
        </UpdateStatus>
      </Group>
      {query.isError ? (
        <Alert color="red" role="alert">
          {getErrorMessage(query.error)}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry versions
          </Button>
        </Alert>
      ) : query.isPending ? (
        <Text role="status" size="sm">
          Loading report versions…
        </Text>
      ) : (
        <>
          <Table className="payout-version-table" aria-label={`Report versions for ${label}`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Version · saved in UTC</Table.Th>
                <Table.Th scope="col" className="numeric">
                  Reported amount
                </Table.Th>
                <Table.Th scope="col" className="numeric">
                  Service fee
                </Table.Th>
                <Table.Th scope="col" className="numeric">
                  Company amount
                </Table.Th>
                <Table.Th scope="col">Details</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const isLatest = rowId(row) === rowId(latest);
                const created = formatRecordDate(row.created_at ?? "");
                return (
                  <Table.Tr key={rowId(row)} data-version={isLatest ? "latest" : "previous"}>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={isLatest ? "teal" : "gray"}>
                        {isLatest ? "Latest" : "Previous version"}
                      </Badge>
                      <Text size="xs" mt={4}>
                        <time dateTime={row.created_at ?? undefined}>{created}</time>
                      </Text>
                    </Table.Td>
                    {["source_amount", "fee_amount", "company_amount"].map((field) => (
                      <Table.Td key={field} className="numeric">
                        {formatExactMoney(row[field] ?? null, currency)}
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <Button
                        variant="light"
                        size="compact-xs"
                        aria-label={
                          isLatest
                            ? "Open latest version"
                            : `Open previous version created ${created}`
                        }
                        onClick={() => {
                          onSelect(row);
                        }}
                      >
                        Open report
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {total === 1 ? (
            <Text size="xs" c="dimmed" mt="xs">
              No previous versions.
            </Text>
          ) : null}
          {pageIndex > 0 || total === null || total > DETAIL_PAGE_SIZE ? (
            <PaginationBar
              ariaLabel={`Report version pagination for ${label}`}
              pageIndex={pageIndex}
              pageCount={pageCount}
              canPrevious={pageIndex > 0}
              canNext={
                pageCount === null ? rows.length === DETAIL_PAGE_SIZE : pageIndex + 1 < pageCount
              }
              isBusy={query.isFetching}
              onPrevious={() => {
                onPageChange(pageIndex - 1);
              }}
              onNext={() => {
                onPageChange(pageIndex + 1);
              }}
              onPageChange={onPageChange}
              summary={`${String(rows.length ? pageIndex * DETAIL_PAGE_SIZE + 1 : 0)}–${String(pageIndex * DETAIL_PAGE_SIZE + rows.length)} of ${total?.toLocaleString("en-US") ?? "—"} versions`}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
