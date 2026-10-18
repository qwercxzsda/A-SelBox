import { Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewFamilyTypes } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { buildFinancialReviewFamilies } from "./financial-review-families";
import type { FinancialReviewSourceProps } from "./financial-review-source-state";

export function FinancialReviewFamilies({
  identity,
  category,
  month,
  matureCutoff,
  currency,
}: Omit<FinancialReviewSourceProps, "state" | "change">) {
  const query = useQuery({
    queryKey: [
      "financial-review",
      "families",
      identity.session.user.id,
      category,
      month,
      matureCutoff,
      currency,
    ],
    queryFn: async ({ signal }) =>
      buildFinancialReviewFamilies(
        await fetchFinancialReviewFamilyTypes(
          identity.session.access_token,
          category,
          month,
          currency,
          signal,
        ),
      ),
    staleTime: Infinity,
  });
  const { families = [], unmatched = [] } = query.data ?? {};
  return (
    <DetailData
      query={query}
      label="fee family comparison"
      rowCount={families.length + unmatched.length}
      emptyMessage="No source types for this currency."
    >
      <Text size="xs" c="dimmed" mb="sm">
        Related fee types are grouped below; their billing dates, SKU allocation and coverage can
        still differ. Difference = Finances − Data Kiosk. No rows on one side contributes zero, not
        proof that its data is complete. Advertising and Sponsored Products remain unpaired because
        their scopes are not established as equivalent.
      </Text>
      {families.length ? (
        <DetailTable
          label="Fee family comparison"
          minWidth={720}
          rows={families}
          rowKey={(row) => row.family ?? ""}
          columns={[
            { key: "family", label: "Fee family" },
            { key: "finances_amount", label: `Finances (${currency})`, kind: "amount" },
            { key: "data_kiosk_amount", label: `Data Kiosk (${currency})`, kind: "amount" },
            { key: "difference", label: `Difference (${currency})`, kind: "amount" },
            { key: "coverage", label: "Available rows" },
          ]}
          renderCell={(row, column) =>
            column.key === "family" ? (
              <span
                title={`Finances: ${row.finances_types ?? ""}\nData Kiosk: ${row.data_kiosk_types ?? ""}`}
              >
                {row.family}
              </span>
            ) : undefined
          }
        />
      ) : null}
      {unmatched.length ? (
        <>
          <Text fw={600} size="sm" mt="md" mb="xs">
            Unpaired or uncertain types
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            These amounts remain in the source totals. No cross-source equivalence is assumed.
          </Text>
          <DetailTable
            label="Unpaired source types"
            minWidth={540}
            rows={unmatched}
            rowKey={(row) => `${row.source ?? ""}:${row.component_type ?? ""}`}
            columns={[
              { key: "source", label: "Source", kind: "source" },
              { key: "component_type", label: "Type", kind: "type" },
              { key: "amount", label: `Amount (${currency})`, kind: "amount" },
            ]}
          />
        </>
      ) : null}
    </DetailData>
  );
}
