import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Group, Table, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import type { Identity } from "./auth-session";
import { formatRecordDate } from "./date-display";
import { formatMoney } from "./decimal";
import { getErrorMessage, rowId } from "./view-model";
import { PaginationBar } from "./PaginationBar";
import { UpdateStatus } from "./UpdateStatus";
import { payoutVersionSelection } from "./payout-report-scope";
import { payoutHistoryQueryOptions } from "./payout-report-queries";

function revealHistory(section: HTMLElement | null) {
  if (!section) return;
  section.focus({ preventScroll: true });
  // The surrounding report table may have been scrolled to its rightmost controls.
  section.scrollIntoView({ block: "start", inline: "start", behavior: "instant" });
}

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
  const sectionRef = useRef<HTMLElement>(null);
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
  function showHistory() {
    revealHistory(sectionRef.current);
  }
  function changePage(page: number) {
    showHistory();
    onPageChange(page);
  }
  const showPagination =
    pageIndex > 0 ||
    (total !== null && total > DETAIL_PAGE_SIZE) ||
    (query.isSuccess && total === null);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="payout-report-history"
      aria-label={`Report versions for ${label}`}
    >
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
          <Text size="sm">{getErrorMessage(query.error)}</Text>
          <Button
            variant="subtle"
            mt="xs"
            onClick={() => {
              showHistory();
              void query.refetch();
            }}
          >
            Retry versions
          </Button>
        </Alert>
      ) : query.isPending ? (
        <Text role="status" size="sm">
          Loading report versions…
        </Text>
      ) : (
        <>
          <div
            className="payout-history-table-scroll"
            role="region"
            aria-label={`Report version amounts for ${label}`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Wide saved amounts remain keyboard-scrollable.
            tabIndex={0}
          >
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
                        <Badge
                          size="xs"
                          variant="light"
                          color={isLatest ? "teal" : "gray"}
                          title={isLatest ? "Newest saved version" : undefined}
                        >
                          {isLatest ? "Latest" : "Previous version"}
                        </Badge>
                        <Text size="xs" mt={4}>
                          <time dateTime={row.created_at ?? undefined}>{created}</time>
                        </Text>
                      </Table.Td>
                      {["source_amount", "fee_amount", "company_amount"].map((field) => (
                        <Table.Td key={field} className="numeric">
                          {formatMoney(row[field] ?? null, currency)}
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
          </div>
          {total === 1 ? (
            <Text size="xs" c="dimmed" mt="xs">
              No previous versions.
            </Text>
          ) : null}
        </>
      )}
      {showPagination ? (
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
            changePage(pageIndex - 1);
          }}
          onNext={() => {
            changePage(pageIndex + 1);
          }}
          onPageChange={changePage}
          summary={
            query.isPending
              ? "Loading report versions…"
              : query.isError
                ? "Report versions unavailable"
                : `${String(rows.length ? pageIndex * DETAIL_PAGE_SIZE + 1 : 0)}–${String(pageIndex * DETAIL_PAGE_SIZE + rows.length)} of ${total?.toLocaleString("en-US") ?? "—"} versions`
          }
        />
      ) : null}
    </section>
  );
}
