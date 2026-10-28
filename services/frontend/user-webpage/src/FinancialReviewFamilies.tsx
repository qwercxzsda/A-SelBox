import { Button, Text } from "@mantine/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CanonicalRow } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { DetailSection } from "./DetailSection";
import { AmountPrecisionNote } from "./AmountPrecisionNote";
import { buildFinancialReviewFamilies } from "./financial-review-families";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";
import { monthlyFamilyTypesQueryOptions } from "./financial-review-queries";
import { compareAbsoluteDecimals } from "./decimal";

function FamilyDefinition({ row }: { row: CanonicalRow }) {
  return (
    <div className="financial-review-family-definition">
      <Text size="sm" fw={600}>
        {row.family}
      </Text>
      <Text size="xs" c="dimmed">
        {row.description}
      </Text>
      <details>
        <summary>Family definition</summary>
        <Text size="xs">Defined Finances types: {row.finances_definition ?? "Unavailable"}</Text>
        <Text size="xs">
          Defined Data Kiosk types: {row.data_kiosk_definition ?? "Unavailable"}
        </Text>
        <Text size="xs">
          Observed Finances types:{" "}
          {row.finances_types === "—" ? "None in this scope" : row.finances_types}
        </Text>
        <Text size="xs">
          Observed Data Kiosk types:{" "}
          {row.data_kiosk_types === "—" ? "None in this scope" : row.data_kiosk_types}
        </Text>
      </details>
    </div>
  );
}

function FeeFamilyTable({
  rows,
  currency,
  label = "Fee family comparison",
  onSelectFamily,
}: {
  rows: CanonicalRow[];
  currency: string;
  label?: string;
  onSelectFamily?: (family: string) => void;
}) {
  const rankedRows = [...rows].sort(
    (left, right) =>
      compareAbsoluteDecimals(right.difference, left.difference) ||
      (left.family ?? "").localeCompare(right.family ?? ""),
  );
  return (
    <>
      <Text size="xs" c="dimmed" mb="sm">
        Each source type belongs to one economic family. Related charges, refunds and corrections
        are combined using their original signs. Difference = Finances − Data Kiosk. A missing side
        contributes zero. Source-only amounts show unmatched coverage, not confirmed errors;
        matching family definitions do not guarantee matching dates or complete records.
      </Text>
      {rows.length ? (
        <>
          <Text size="xs" c="dimmed" mb="sm">
            Largest absolute difference first. Source-only families are identified separately from
            missing rows in paired families. Month counts cover months with that family's records.
          </Text>
          <DetailTable
            label={label}
            minWidth={onSelectFamily ? 920 : 820}
            rows={rankedRows}
            rowKey={(row) => row.family_id ?? ""}
            columns={[
              { key: "family", label: "Fee family" },
              { key: "finances_amount", label: `Finances (${currency})`, kind: "amount" },
              { key: "data_kiosk_amount", label: `Data Kiosk (${currency})`, kind: "amount" },
              { key: "difference", label: `Difference (${currency})`, kind: "amount" },
              { key: "coverage", label: "Source coverage" },
              ...(onSelectFamily ? [{ key: "focus", label: "Investigate" }] : []),
            ]}
            renderCell={(row, column) =>
              column.key === "family" ? (
                <FamilyDefinition row={row} />
              ) : column.key === "focus" && onSelectFamily ? (
                <Button
                  size="compact-xs"
                  variant="light"
                  aria-label={`Show only ${row.family ?? "this family"}`}
                  onClick={() => {
                    if (row.family_id) onSelectFamily(row.family_id);
                  }}
                >
                  Show only
                </Button>
              ) : undefined
            }
          />
          <AmountPrecisionNote />
        </>
      ) : null}
    </>
  );
}

export function FinancialReviewFamilyBreakdown({
  query,
  category,
  currency,
  families,
  onSelectFamily,
}: {
  query: UseQueryResult<CanonicalRow[]>;
  category: string;
  currency: string;
  families: readonly string[];
  onSelectFamily: (family: string) => void;
}) {
  const rows = buildFinancialReviewFamilies(query.data ?? [], families);
  return (
    <DetailSection
      title="Fee family breakdown"
      headingOrder={2}
      stateKey={`financial-review:family-breakdown:${category}`}
      collapsible
    >
      <DetailData
        query={query}
        label="fee family breakdown"
        rowCount={rows.length}
        emptyMessage="No source types match these fee families for this year and currency."
      >
        <FeeFamilyTable
          rows={rows}
          currency={currency}
          label="Yearly fee family breakdown"
          onSelectFamily={onSelectFamily}
        />
      </DetailData>
    </DetailSection>
  );
}

export function FinancialReviewFamilies({
  identity,
  category,
  month,
  matureCutoff,
  currency,
  families,
}: FinancialReviewMonthScope) {
  const query = useQuery({
    ...monthlyFamilyTypesQueryOptions({
      identity,
      category,
      month,
      matureCutoff,
      currency,
    }),
    select: (rows) => buildFinancialReviewFamilies(rows, families),
  });
  const rows = query.data ?? [];
  return (
    <DetailData
      query={query}
      label="fee family comparison"
      rowCount={rows.length}
      emptyMessage="No source types match these fee families."
    >
      <FeeFamilyTable rows={rows} currency={currency} />
    </DetailData>
  );
}
