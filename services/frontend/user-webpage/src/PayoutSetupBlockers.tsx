import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Text } from "@mantine/core";
import type { Identity } from "./auth-session";
import { fetchPayoutSetupBlockers } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";
import { LookupPagination } from "./LookupPagination";
import { revealSection } from "./reveal-section";

export function PayoutSetupBlockers({
  identity,
  companyId,
  month,
}: {
  identity: Identity;
  companyId: string;
  month: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `payout-setup:${companyId}:${month}`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: ["payout-blockers", identity.session.user.id, companyId, month, pageIndex],
    queryFn: ({ signal }) =>
      fetchPayoutSetupBlockers(identity.session.access_token, companyId, month, pageIndex, signal),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  function changePage(nextPage: number) {
    setPageIndex(nextPage);
    revealSection(listRef.current);
  }
  return (
    <div
      ref={listRef}
      tabIndex={-1}
      role="region"
      aria-label="Payout setup requirements"
      className="payout-setup-blockers"
      style={{ scrollMarginTop: 16 }}
    >
      <Text size="sm" mb="xs">
        These inputs prevent a complete report for this month. Correct the setup; the report will
        retry automatically.
      </Text>
      <DetailData
        query={query}
        label="payout setup requirements"
        rowCount={rows.length}
        emptyMessage="No ownership or fee requirements remain. Automatic processing will check the source data again."
      >
        {rows.length ? (
          <DetailTable
            label="Payout setup requirements"
            rows={rows}
            rowKey={(row) => `${row.sku ?? ""}:${row.reason ?? ""}:${row.marketplace_name ?? ""}`}
            minWidth={600}
            columns={[
              { key: "sku", label: "SKU", empty: "Unavailable SKU" },
              { key: "reason", label: "Setup needed" },
              { key: "marketplace_name", label: "Marketplace" },
              { key: "first_date", label: "First affected date" },
              { key: "last_date", label: "Last affected date" },
            ]}
            renderCell={(row, column) =>
              column.key === "reason"
                ? row.reason === "MISSING_OWNERSHIP"
                  ? "Assign company ownership"
                  : "Add fee coverage"
                : undefined
            }
          />
        ) : null}
      </DetailData>
      {pageIndex > 0 || query.data?.hasNext ? (
        <LookupPagination
          label="requirements"
          pageLabel="Setup page"
          pageIndex={pageIndex}
          hasNext={query.data?.hasNext ?? false}
          disabled={query.isFetching}
          onPageChange={changePage}
          mt="xs"
        />
      ) : null}
    </div>
  );
}
