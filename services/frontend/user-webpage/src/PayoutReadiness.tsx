import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { Identity } from "./auth-session";
import { fetchPayoutReadiness } from "./api";
import { formatRecordDate, formatRecordMonth } from "./date-display";
import { PayoutSetupBlockers } from "./PayoutSetupBlockers";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage, decodeDetailStrings } from "./detail-view-state";
import { LookupPagination } from "./LookupPagination";
import { revealSection } from "./reveal-section";

const STATUS: Partial<Record<string, { label: string; color: string; description: string }>> = {
  PENDING: {
    label: "Pending",
    color: "blue",
    description: "This month is waiting for automatic processing.",
  },
  UPDATING: {
    label: "Updating",
    color: "blue",
    description: "New inputs are queued. The previously saved report remains available.",
  },
  BLOCKED: {
    label: "Blocked",
    color: "orange",
    description: "Processing needs attention before this month can be completed.",
  },
  COMPLETE: {
    label: "Complete",
    color: "teal",
    description: "The saved report uses the latest processed inputs.",
  },
  NO_ACTIVITY: {
    label: "No activity",
    color: "gray",
    description: "Processing completed with no payout records for this company and month.",
  },
  NOT_SCHEDULED: {
    label: "Not scheduled",
    color: "gray",
    description: "This company has no assigned SKUs. Reports start automatically after setup.",
  },
  IMMATURE: {
    label: "Not mature",
    color: "gray",
    description: "This month will be processed automatically once it is fully mature.",
  },
};

export function PayoutReadiness({
  identity,
  month,
  companyIds,
  onConfigureSku,
  marketplaceFiltered = false,
}: {
  identity: Identity;
  month: string;
  companyIds: string[];
  onConfigureSku?: (sku: string) => void;
  marketplaceFiltered?: boolean;
}) {
  const listRef = useRef<HTMLElement>(null);
  const scope = `payout-readiness:${month}:${JSON.stringify([...companyIds].sort())}`;
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `${scope}:page`,
    () => 0,
    decodeDetailPage,
  );
  const [expanded, setExpanded] = useWorkspacePreference(
    `${scope}:expanded`,
    () => [] as string[],
    decodeDetailStrings,
  );
  const administrator = identity.account.access_role === "administrator";
  const query = useQuery({
    queryKey: ["payout-readiness", identity.session.user.id, month, companyIds, pageIndex],
    queryFn: ({ signal }) =>
      fetchPayoutReadiness(identity.session.access_token, month, companyIds, pageIndex, signal),
    staleTime: Infinity,
  });
  function changePage(nextPage: number) {
    setPageIndex(nextPage);
    revealSection(listRef.current);
  }
  return (
    <Paper
      withBorder
      p="sm"
      mb="md"
      component="section"
      ref={listRef}
      tabIndex={-1}
      style={{ scrollMarginTop: 16 }}
      aria-label={`${formatRecordMonth(month)} payout readiness`}
    >
      <Text size="sm" fw={600} mb="xs">
        {formatRecordMonth(month)} readiness
      </Text>
      {marketplaceFiltered ? (
        <Text size="xs" c="dimmed" mb="xs">
          Readiness covers all marketplaces for each company and month.
        </Text>
      ) : null}
      {query.isPending ? (
        <Text size="sm" role="status">
          Checking payout readiness…
        </Text>
      ) : null}
      {query.isError ? (
        <Alert color="orange" role="status">
          Readiness is temporarily unavailable. It will be checked again automatically.
        </Alert>
      ) : null}
      {query.isSuccess && !query.data.rows.length ? (
        <Text size="sm">No companies in this scope.</Text>
      ) : null}
      <Stack gap="sm">
        {(query.data?.rows ?? []).map((row) => {
          const status = STATUS[row.status ?? ""];
          if (!status) return null;
          const companyId = row.company_id ?? "";
          const setup = row.status === "BLOCKED" && row.reason === "SETUP_REQUIRED";
          const description = setup
            ? administrator
              ? "SKU ownership or fee coverage needs setup. Review the requirements below."
              : "An administrator needs to complete SKU ownership or fee setup."
            : row.status === "BLOCKED" && row.reason === "SOURCE_REQUIRED"
              ? "Required source data is incomplete or incompatible. Automatic processing will retry after updates."
              : status.description;
          return (
            <div key={companyId}>
              <Group gap="xs" justify="space-between">
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {row.company_name}
                  </Text>
                  <Badge color={status.color} variant="light">
                    {status.label}
                  </Badge>
                </Group>
                {setup && administrator ? (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    aria-expanded={expanded.includes(companyId)}
                    onClick={() => {
                      setExpanded((current) =>
                        current.includes(companyId)
                          ? current.filter((id) => id !== companyId)
                          : [...current, companyId],
                      );
                    }}
                  >
                    {expanded.includes(companyId)
                      ? "Hide setup requirements"
                      : "View setup requirements"}
                  </Button>
                ) : null}
              </Group>
              <Text size="xs" c="dimmed">
                {description}
              </Text>
              {row.next_attempt_at ? (
                <Text size="xs" c="dimmed">
                  Next automatic attempt: {formatRecordDate(row.next_attempt_at)}
                </Text>
              ) : null}
              {setup && administrator && expanded.includes(companyId) ? (
                <PayoutSetupBlockers
                  identity={identity}
                  companyId={companyId}
                  month={month}
                  onConfigureSku={onConfigureSku}
                />
              ) : null}
            </div>
          );
        })}
      </Stack>
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
    </Paper>
  );
}
