import { useState } from "react";
import { Group, Select, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialOutcomes, fetchOutcomeMonths } from "./api";
import type { Identity } from "./auth-session";
import { decodeOutcomeFilters } from "./outcome-filters";
import { useWorkspacePreference } from "./use-workspace-preference";
import { OUTCOMES } from "./api/allocations";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { PayoutReadiness } from "./PayoutReadiness";
import { sourceCodeLabel } from "./categories";
import marketplaces from "./generated/marketplaces.json";
import type { DetailColumn } from "./detail-columns";

const OUTCOME_LABELS = {
  DIFFERENCE: "Differences",
  SELBOX: "SelBox types",
  COMPANY: "Company amounts",
};
const SCOPE_COLUMNS: DetailColumn[] = [
  { key: "seller_namespace", label: "Seller account" },
  { key: "amazon_scope", label: "Region" },
  { key: "marketplace_name", label: "Marketplace" },
  { key: "currency", label: "Currency" },
];
const AMOUNTS: DetailColumn[] = [
  { key: "base_amount", label: "Base", kind: "number" },
  { key: "tax_amount", label: "Tax", kind: "number" },
];
const DETAIL_COLUMNS: DetailColumn[] = [
  { key: "posted_date", label: "Posting date", kind: "date" },
  ...SCOPE_COLUMNS,
  { key: "component_type", label: "Type", kind: "type" },
  { key: "source", label: "Source", kind: "source" },
  { key: "reference_id", label: "Reference ID" },
  { key: "sku", label: "SKU" },
  { key: "fnsku", label: "FNSKU" },
  { key: "asin", label: "ASIN" },
  ...AMOUNTS,
];
const MONTH_COLUMNS: DetailColumn[] = [
  { key: "month", label: "Month" },
  ...SCOPE_COLUMNS,
  ...["Finances", "Company", "SelBox", "Difference"].flatMap((label): DetailColumn[] => [
    { key: label.toLowerCase() + "_base", label: label + " base", kind: "number" },
    { key: label.toLowerCase() + "_tax", label: label + " tax", kind: "number" },
  ]),
];

export function FinancialReview({ identity }: { identity: Identity }) {
  const [{ view, month, marketplace }, setScope] = useWorkspacePreference(
    "financial-review:filters",
    () => decodeOutcomeFilters(null),
    decodeOutcomeFilters,
  );
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["financial-review", identity.session.user.id, view, month, marketplace, page],
    queryFn: ({ signal }) =>
      view === "MONTHS"
        ? fetchOutcomeMonths(identity.session.access_token, month, marketplace, page, signal)
        : fetchFinancialOutcomes(
            identity.session.access_token,
            { outcome: view, month, marketplace },
            page,
            signal,
          ),
    enabled: identity.account.access_role === "administrator",
  });
  if (identity.account.access_role !== "administrator") return null;
  const rows = query.data?.rows ?? [];
  return (
    <>
      <WorkspaceHeader
        title="Financial review"
        help={
          <p>
            Finances determines activity. Each amount belongs to one company, a SelBox type or a
            difference. Monthly totals separate each seller account, marketplace and currency.
            Differences update when references or assignments change.
          </p>
        }
      />
      <Group mb="md" align="end">
        <Select
          label="Show"
          value={view}
          data={[
            ...OUTCOMES.map((v) => ({ value: v, label: OUTCOME_LABELS[v] })),
            { value: "MONTHS", label: "Monthly totals" },
          ]}
          allowDeselect={false}
          onChange={(v) => {
            setScope({ view: OUTCOMES.find((o) => o === v) ?? "MONTHS", month, marketplace });
            setPage(0);
          }}
        />
        <TextInput
          label="Month"
          type="month"
          value={month}
          onChange={(e) => {
            setScope({ view, month: e.currentTarget.value, marketplace });
            setPage(0);
          }}
        />
        <Select
          label="Marketplace"
          placeholder="All marketplaces"
          clearable
          searchable
          data={marketplaces}
          value={marketplace || null}
          onChange={(v) => {
            setScope({ view, month, marketplace: v ?? "" });
            setPage(0);
          }}
        />
      </Group>
      <DetailData
        label="financial outcomes"
        query={query}
        rowCount={rows.length}
        emptyMessage="No financial outcomes match these filters."
        pagination={{
          pageIndex: page,
          totalCount: query.data?.totalCount ?? null,
          onPageChange: setPage,
        }}
      >
        {rows.length > 0 && (
          <DetailTable
            label={view === "MONTHS" ? "Monthly totals" : OUTCOME_LABELS[view]}
            minWidth={900}
            rows={rows}
            columns={
              view === "MONTHS"
                ? MONTH_COLUMNS
                : [
                    ...DETAIL_COLUMNS,
                    view === "SELBOX"
                      ? { key: "selbox_group", label: "SelBox group" }
                      : view === "COMPANY"
                        ? { key: "company_id", label: "Company" }
                        : { key: "reason", label: "Reason" },
                  ]
            }
            rowKey={(row) =>
              JSON.stringify(
                view === "MONTHS"
                  ? [
                      row.month,
                      row.seller_namespace,
                      row.amazon_scope,
                      row.marketplace_name,
                      row.currency,
                    ]
                  : [
                      row.source_row_id,
                      row.outcome,
                      row.reason,
                      row.marketplace_name,
                      row.posted_date,
                    ],
              )
            }
            renderCell={(row, column) => {
              if (column.key === "company_id")
                return identity.companies.find((c) => c.id === row.company_id)?.name ?? "—";
              if (column.key === "reason" || column.key === "selbox_group")
                return sourceCodeLabel(row[column.key] ?? "—");
              return undefined;
            }}
          />
        )}
      </DetailData>
      {month && <PayoutReadiness identity={identity} month={month} companyIds={[]} />}
    </>
  );
}
