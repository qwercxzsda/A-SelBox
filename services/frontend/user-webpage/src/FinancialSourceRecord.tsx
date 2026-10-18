import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialSourceRecord } from "./api";
import type { FinancialSourceSelection } from "./api/financial-source";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { RowDetail } from "./RowDetail";

export function FinancialSourceRecord({
  identity,
  selection,
  onClose,
  onExitTransitionEnd,
  stacked = false,
}: {
  identity: Identity;
  selection: FinancialSourceSelection | null;
  onClose: () => void;
  onExitTransitionEnd?: () => void;
  stacked?: boolean;
}) {
  const query = useQuery({
    queryKey: ["financial-source-record", identity.session.user.id, selection],
    queryFn: ({ signal }) => {
      if (!selection) throw new Error("Choose a source record");
      return fetchFinancialSourceRecord(identity.session.access_token, selection, signal);
    },
    enabled: selection !== null && identity.account.access_role === "administrator",
    staleTime: Infinity,
  });
  if (identity.account.access_role !== "administrator") return null;
  return (
    <>
      {selection && !query.data ? (
        <DetailData
          query={query}
          label="source record"
          rowCount={0}
          emptyMessage="This exact source row/version is no longer available. It has not been replaced with another capture."
        >
          <Button variant="subtle" size="xs" onClick={onClose}>
            Close source lookup
          </Button>
        </DetailData>
      ) : null}
      <RowDetail
        companies={new Map(identity.companies.map((company) => [company.id, company.name]))}
        dataset={selection?.source === "DATA_KIOSK" ? "data_kiosk" : "finances"}
        row={selection ? (query.data ?? null) : null}
        isAdministrator
        accessToken={identity.session.access_token}
        onClose={onClose}
        onExitTransitionEnd={onExitTransitionEnd}
        stackId={stacked ? "financial-review-source-record" : undefined}
      />
    </>
  );
}
