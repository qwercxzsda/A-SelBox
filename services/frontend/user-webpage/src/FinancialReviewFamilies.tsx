import { Button, Text } from "@mantine/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CanonicalRow } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { DetailSection } from "./DetailSection";
import { AmountPrecisionNote } from "./AmountPrecisionNote";
import { buildFinancialReviewFamilies } from "./financial-review-families";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";
import {
  monthlyFamilyTypesQueryOptions,
  monthlySourceTotalsQueryOptions,
} from "./financial-review-queries";
import { compareAbsoluteDecimals } from "./decimal";
import { applyComparisonCoverage, sameSourceRevision } from "./source-diagnostics";
import { useSourceRevisionGuard, diagnosticQueryState } from "./source-diagnostics-context";
import type { SourceTotals } from "./api/source-totals";
import type { SourceTypeTotals } from "./api/financial-review-type-reader";

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
      (left.difference === right.difference
        ? 0
        : left.difference === null
          ? 1
          : right.difference === null
            ? -1
            : compareAbsoluteDecimals(right.difference, left.difference)) ||
      (left.family ?? "").localeCompare(right.family ?? ""),
  );
  return (
    <>
      <Text size="xs" c="dimmed" mb="sm">
        Each source type belongs to one economic family. Related charges, refunds and corrections
        are combined using their original signs. Difference = Finances − Data Kiosk. A missing side
        is zero only when retrieval coverage includes the period. Source-only amounts are
        diagnostic; matching family definitions do not guarantee matching dates or complete records.
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
  marketplace,
  families,
  onSelectFamily,
  sourceTotals,
  sourceQuery,
}: {
  query: UseQueryResult<SourceTypeTotals>;
  sourceQuery: UseQueryResult<SourceTotals>;
  sourceTotals: SourceTotals | undefined;
  category: string;
  currency: string;
  marketplace: string;
  families: readonly string[];
  onSelectFamily: (family: string) => void;
}) {
  const consistent = useSourceRevisionGuard(query.data);
  const rows =
    consistent && sourceTotals && sameSourceRevision(sourceTotals, query.data)
      ? applyComparisonCoverage(
          buildFinancialReviewFamilies(query.data?.rows ?? [], families),
          sourceTotals,
        )
      : [];
  return (
    <DetailSection
      title="Fee family breakdown"
      headingOrder={2}
      stateKey={`financial-review:family-breakdown:${category}`}
      collapsible
    >
      <DetailData
        query={diagnosticQueryState(
          [query, sourceQuery],
          consistent && sourceTotals !== undefined && sameSourceRevision(sourceTotals, query.data),
        )}
        label="fee family breakdown"
        rowCount={rows.length}
        emptyMessage={`No source types match these fee families for ${marketplace} in this year and currency.`}
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

export function FinancialReviewFamilies(scope: FinancialReviewMonthScope) {
  const { families, currency } = scope;
  const query = useQuery({
    ...monthlyFamilyTypesQueryOptions(scope),
  });
  const sourceQuery = useQuery(monthlySourceTotalsQueryOptions(scope));
  const consistent = useSourceRevisionGuard(query.data);
  const sourceConsistent = useSourceRevisionGuard(sourceQuery.data);
  const rows =
    consistent &&
    sourceConsistent &&
    sourceQuery.data &&
    sameSourceRevision(sourceQuery.data, query.data)
      ? applyComparisonCoverage(
          buildFinancialReviewFamilies(query.data?.rows ?? [], families),
          sourceQuery.data,
        )
      : [];
  return (
    <DetailData
      query={diagnosticQueryState(
        [query, sourceQuery],
        consistent && sourceConsistent && sameSourceRevision(sourceQuery.data, query.data),
      )}
      label="fee family comparison"
      rowCount={rows.length}
      emptyMessage="No source types match these fee families."
    >
      <FeeFamilyTable rows={rows} currency={currency} />
    </DetailData>
  );
}
