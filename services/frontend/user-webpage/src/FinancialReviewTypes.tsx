import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewTypes } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { humanizeCode, sourceCodeLabel } from "./categories";
import type { FinancialReviewSourceProps } from "./financial-review-source-state";

export function FinancialReviewTypes({
  identity,
  category,
  month,
  currency,
  marketplace,
  families,
  state,
  change,
  onSelect,
}: FinancialReviewSourceProps & { onSelect: () => void }) {
  const query = useQuery({
    queryKey: [
      "financial-review",
      "types",
      identity.session.user.id,
      category,
      month,
      currency,
      marketplace,
      families,
      state.typePage,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewTypes(
        identity.session.access_token,
        category,
        month,
        currency,
        marketplace,
        state.typePage,
        signal,
        families,
      ),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <DetailData
      query={query}
      label="amounts by type"
      rowCount={rows.length}
      emptyMessage="No source types for this currency."
      pagination={{
        pageIndex: state.typePage,
        totalCount: query.data?.totalCount ?? null,
        onPageChange: (typePage) => {
          change({ typePage });
        },
      }}
    >
      {rows.length ? (
        <DetailTable
          label="Amounts by type"
          className="financial-review-types"
          minWidth={720}
          columns={[
            { key: "source", label: "Source", kind: "source" },
            { key: "component_type", label: "Type", kind: "type" },
            { key: "amount", label: `Amount (${currency})`, kind: "amount" },
            { key: "row_count", label: "Records", kind: "number" },
            { key: "details", label: "Details" },
          ]}
          rows={rows}
          rowKey={(row) => `${row.source ?? ""}:${row.component_type ?? ""}`}
          selectedRowKey={state.type ? `${state.source}:${state.type}` : null}
          renderCell={(row, column) => {
            if (column.key !== "details") return undefined;
            return (
              <Button
                className="ui-text-action"
                size="compact-xs"
                variant="subtle"
                aria-label={`View records for ${humanizeCode(row.source ?? "")} · ${sourceCodeLabel(row.component_type ?? "")}`}
                onClick={() => {
                  change({
                    source: row.source === "FINANCES" ? "FINANCES" : "DATA_KIOSK",
                    type: row.component_type ?? "",
                    recordPage: 0,
                    recordsOpen: true,
                  });
                  onSelect();
                }}
              >
                View records
              </Button>
            );
          }}
        />
      ) : null}
    </DetailData>
  );
}
