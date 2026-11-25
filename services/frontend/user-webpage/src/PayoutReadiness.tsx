import { useQuery } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { Stack, Table, Text } from "@mantine/core";
import type { Identity } from "./auth-session";
import { fetchPayoutReadiness } from "./api";
import type { PayoutReadinessFacts } from "./api/payout-readiness";
import { formatRecordDate, formatRecordMonth } from "./date-display";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";
import { PayoutSetupBlockers } from "./PayoutSetupBlockers";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailStrings } from "./detail-view-state";
import { LookupPagination } from "./LookupPagination";
import { revealSection } from "./reveal-section";
import { payoutReadinessState } from "./payout-readiness";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { TableDisclosure } from "./TableDisclosure";
import "./DetailTable.css";
import "./PayoutReadiness.css";

type ReadinessState = ReturnType<typeof payoutReadinessState>;

const STATUS: Record<ReadinessState["status"], { label: string; tone: StatusTone; note: string }> =
  {
    PENDING: { label: "Pending", tone: "info", note: "Waiting for processing" },
    UPDATING: {
      label: "Updating",
      tone: "info",
      note: "New data queued; saved report stays available",
    },
    BLOCKED: {
      label: "Blocked",
      tone: "warning",
      note: "Needs attention before the report can finish",
    },
    COMPLETE: { label: "Complete", tone: "success", note: "Report is up to date" },
    NO_ACTIVITY: { label: "No activity", tone: "neutral", note: "No activity this month" },
    NOT_SCHEDULED: {
      label: "Not scheduled",
      tone: "neutral",
      note: "Starts when the company has SKUs",
    },
    IMMATURE: {
      label: "Not mature",
      tone: "neutral",
      note: "Processed two months after month end",
    },
  };

const COLUMNS = ["Company", "Status", "Note", "Next retry (UTC)"];

function readinessNote(state: ReadinessState) {
  if (state.status === "BLOCKED" && state.reason === "SETUP_REQUIRED") return "Missing fee rates";
  if (state.status === "BLOCKED" && state.reason === "SOURCE_REQUIRED")
    return "Source data incomplete; retries after next import";
  return STATUS[state.status].note;
}

/** One company's row; a company missing fee rates expands to its setup requirements beneath. */
function CompanyReadiness({
  identity,
  row,
  month,
  expanded,
  onToggle,
}: {
  identity: Identity;
  row: PayoutReadinessFacts;
  month: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const setupId = useId();
  const state = payoutReadinessState(row);
  const status = STATUS[state.status];
  const setup = state.status === "BLOCKED" && state.reason === "SETUP_REQUIRED";
  return (
    <>
      <Table.Tr>
        <Table.Th scope="row">{row.company_name}</Table.Th>
        <Table.Td>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </Table.Td>
        <Table.Td>
          <div className="payout-readiness-note">
            <span>{readinessNote(state)}</span>
            {setup ? (
              <TableDisclosure
                expanded={expanded}
                subject="setup requirements"
                context={row.company_name}
                controlsId={expanded ? setupId : undefined}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        </Table.Td>
        <Table.Td data-kind="date">
          {state.nextAttemptAt
            ? formatRecordDate(state.nextAttemptAt, { includeTimeZone: false })
            : "—"}
        </Table.Td>
      </Table.Tr>
      {setup && expanded ? (
        <Table.Tr className="payout-readiness-setup-row">
          <Table.Td id={setupId} colSpan={COLUMNS.length}>
            <PayoutSetupBlockers identity={identity} companyId={row.company_id} month={month} />
          </Table.Td>
        </Table.Tr>
      ) : null}
    </>
  );
}

/**
 * Each company's payout report state for one month, across all marketplaces. The month drawer
 * owns the page, so another month starts on page 1.
 */
export function PayoutReadiness({
  identity,
  month,
  pageIndex,
  onPageChange,
}: {
  identity: Identity;
  month: string;
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useWorkspacePreference(
    `payout-readiness:${month}:expanded`,
    () => [] as string[],
    decodeDetailStrings,
  );
  const query = useQuery({
    queryKey: ["payout-readiness", identity.session.user.id, month, pageIndex],
    queryFn: ({ signal }) =>
      fetchPayoutReadiness(identity.session.access_token, month, [], pageIndex, signal),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  function changePage(nextPage: number) {
    onPageChange(nextPage);
    revealSection(listRef.current);
  }
  return (
    <Stack
      component="section"
      ref={listRef}
      tabIndex={-1}
      gap={0}
      className="payout-readiness"
      aria-label={`${formatRecordMonth(month)} payout readiness`}
    >
      {query.isPending ? (
        <Text size="sm" role="status">
          Checking payout readiness…
        </Text>
      ) : null}
      {query.isError ? (
        // Workspace polling repeats a failed readiness read.
        <ErrorAlert
          title="Could not load payout readiness"
          detail={loadErrorDetail(query.error)}
          retriesAutomatically
        />
      ) : null}
      {query.isSuccess && !rows.length ? (
        <Text size="sm" c="dimmed">
          No companies in this scope
        </Text>
      ) : null}
      {rows.length ? (
        <div
          className="detail-table-scroll"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
          tabIndex={0}
          role="region"
          aria-label="Companies table"
        >
          <Table className="detail-table payout-readiness-table" aria-label="Companies">
            <Table.Thead>
              <Table.Tr>
                {COLUMNS.map((column) => (
                  <Table.Th key={column} scope="col">
                    {column}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <CompanyReadiness
                  key={row.company_id}
                  identity={identity}
                  row={row}
                  month={month}
                  expanded={expanded.includes(row.company_id)}
                  onToggle={() => {
                    setExpanded((current) =>
                      current.includes(row.company_id)
                        ? current.filter((id) => id !== row.company_id)
                        : [...current, row.company_id],
                    );
                  }}
                />
              ))}
            </Table.Tbody>
          </Table>
        </div>
      ) : null}
      {pageIndex > 0 || query.data?.hasNext ? (
        <LookupPagination
          label="companies"
          pageLabel="Company page"
          pageIndex={pageIndex}
          hasNext={query.data?.hasNext ?? false}
          disabled={query.isFetching}
          onPageChange={changePage}
        />
      ) : null}
    </Stack>
  );
}
