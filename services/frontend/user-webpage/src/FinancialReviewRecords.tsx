import { Button, Group, NativeSelect } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewRecords } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { transactionTypeLabel } from "./categories";
import type { FinancialReviewSourceProps } from "./financial-review-source-state";

export function FinancialReviewRecords({
  identity,
  category,
  month,
  matureCutoff,
  currency,
  state,
  change,
}: FinancialReviewSourceProps) {
  const query = useQuery({
    queryKey: [
      "financial-review",
      "records",
      identity.session.user.id,
      category,
      month,
      matureCutoff,
      currency,
      state.source,
      state.type,
      state.recordPage,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewRecords(
        identity.session.access_token,
        category,
        month,
        currency,
        state.recordPage,
        { source: state.source || undefined, type: state.type || undefined },
        signal,
      ),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <>
      <Group mb="sm" gap="sm" align="end">
        <NativeSelect
          label="Record source"
          value={state.source}
          data={[
            { value: "", label: "All sources" },
            { value: "SETTLEMENT", label: "Settlement" },
            { value: "DATA_KIOSK", label: "Data Kiosk" },
          ]}
          onChange={(event) => {
            const source = event.currentTarget.value;
            change({
              source: source === "SETTLEMENT" || source === "DATA_KIOSK" ? source : "",
              type: "",
              recordPage: 0,
            });
          }}
        />
        {state.type ? (
          <Button
            className="applied-table-filter"
            size="xs"
            variant="light"
            aria-label="Clear selected type"
            title={transactionTypeLabel(state.type)}
            rightSection={<span aria-hidden="true">×</span>}
            onClick={() => {
              change({ type: "", recordPage: 0 });
            }}
          >
            <span className="applied-table-filter-text">{transactionTypeLabel(state.type)}</span>
          </Button>
        ) : null}
      </Group>
      <DetailData
        query={query}
        label="source records"
        rowCount={rows.length}
        emptyMessage="No source records match this selection."
        pagination={{
          pageIndex: state.recordPage,
          totalCount: query.data?.totalCount ?? null,
          onPageChange: (recordPage) => {
            change({ recordPage });
          },
        }}
      >
        {rows.length ? (
          <DetailTable
            label="Source records"
            rows={rows}
            rowKey={(row) => `${row.source ?? ""}:${row.source_row_id ?? ""}`}
            minWidth={1200}
            columns={[
              { key: "activity_date", label: "Date", kind: "date" },
              { key: "source", label: "Source", kind: "source", nowrap: true },
              { key: "sku", label: "SKU", empty: "Account-level", nowrap: true },
              { key: "marketplace_name", label: "Marketplace", empty: "Not specified" },
              { key: "component_type", label: "Type", kind: "type" },
              { key: "amount", label: `Amount (${currency})`, kind: "number" },
              { key: "seller_namespace", label: "Source namespace" },
              { key: "source_version_id", label: "Source version" },
              { key: "source_row_id", label: "Source row" },
            ]}
          />
        ) : null}
      </DetailData>
    </>
  );
}
