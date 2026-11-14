import { Button, Group, Stack, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { DetailTable } from "./DetailTable";
import { HelpPopover } from "./HelpPopover";
import { compareAbsoluteDecimals } from "./decimal";
import type { DetailColumn } from "./detail-columns";
import { isUnmappedSourceAmount } from "./financial-review-categories";

const SECTIONS = [
  {
    kind: "paired",
    title: "Paired type families",
    metric: { key: "difference", label: "Difference" },
    description:
      "Defined counterparts, ordered by their comparable difference. Pairing identifies related activity, not matched billing dates or individual transactions. Missing paired records count as zero only with complete retrieval coverage.",
  },
  {
    kind: "different-basis",
    title: "Different reporting basis",
    metric: { key: "source_gap", label: "Source gap" },
    description:
      "These mapped sources use different definitions or dates. Their source gap is not a like-for-like difference.",
  },
  {
    kind: "unpaired",
    title: "Unpaired activity",
    metric: null,
    description:
      "No verified counterpart mapping is defined. Another source may include this activity in a broader amount or may not provide it separately. These amounts remain in source totals and records without being ranked as discrepancies.",
  },
] as const;

function FamilyDefinition({ row }: { row: CanonicalRow }) {
  return (
    <div>
      <Group
        gap={4}
        wrap="nowrap"
        align="flex-start"
        className="financial-review-family-definition"
      >
        <Text size="var(--ui-font-data)" fw={500}>
          {row.family}
        </Text>
        <HelpPopover label={`Family definition for ${row.family ?? "this family"}`}>
          <Text size="sm">{row.description}</Text>
          {row.comparison_basis !== row.description ? (
            <Text size="sm">{row.comparison_basis}</Text>
          ) : null}
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
        </HelpPopover>
      </Group>
      {row.comparison_kind === "different-basis" ? (
        <Text size="xs" c="dimmed" mt={4}>
          {row.comparison_basis}
        </Text>
      ) : null}
    </div>
  );
}

function alphabeticalOrder(left: CanonicalRow, right: CanonicalRow): number {
  return (left.family ?? "").localeCompare(right.family ?? "");
}

function pairedOrder(left: CanonicalRow, right: CanonicalRow): number {
  if (left.difference === right.difference) return alphabeticalOrder(left, right);
  if (left.difference === null) return 1;
  if (right.difference === null) return -1;
  return (
    compareAbsoluteDecimals(right.difference, left.difference) || alphabeticalOrder(left, right)
  );
}

function renderFamilyCell(
  row: CanonicalRow,
  column: DetailColumn,
  onSelectFamily?: (family: string) => void,
) {
  if (column.key === "family") return <FamilyDefinition row={row} />;
  const incomplete = column.key === "difference" && row.difference === null;
  if (incomplete || isUnmappedSourceAmount(row, column.key))
    return (
      <Text component="span" size="sm" c="dimmed">
        {incomplete ? "Incomplete coverage" : "No mapped type"}
      </Text>
    );
  if (column.key === "focus" && onSelectFamily)
    return (
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
    );
  return undefined;
}

/** Different source relationships stay visible without turning unmatched amounts into errors. */
export function FinancialReviewFamilyTables({
  rows,
  currency,
  period,
  onSelectFamily,
}: {
  rows: CanonicalRow[];
  currency: string;
  period: "Yearly" | "Monthly";
  onSelectFamily?: (family: string) => void;
}) {
  if (!rows.length) return null;
  const incompleteCoverage = rows.some(
    (row) =>
      (row.finances_expected === "true" && row.finances_covered === "false") ||
      (row.data_kiosk_expected === "true" && row.data_kiosk_covered === "false"),
  );
  return (
    <Stack component="section" gap="lg" aria-label={`${period} type family breakdown`}>
      {incompleteCoverage ? (
        <Text size="sm" c="dimmed">
          Amounts reflect available records; the selected period is not fully covered.
        </Text>
      ) : null}
      {SECTIONS.map((section) => {
        const sectionRows = rows
          .filter((row) => row.comparison_kind === section.kind)
          .sort(section.kind === "paired" ? pairedOrder : alphabeticalOrder);
        if (!sectionRows.length) return null;
        const label = `${period} ${section.title.toLowerCase()}`;
        const metric: DetailColumn[] = section.metric
          ? [{ ...section.metric, label: `${section.metric.label} (${currency})`, kind: "amount" }]
          : [];
        return (
          <section key={section.kind} aria-label={label}>
            <Text component={period === "Yearly" ? "h4" : "h5"} m={0} fw={600} size="sm">
              {section.title}
            </Text>
            <Text size="sm" c="dimmed" mt={4} mb="sm">
              {section.description}
            </Text>
            <DetailTable
              label={label}
              minWidth={onSelectFamily ? 920 : 820}
              rows={sectionRows}
              rowKey={(row) => row.family_id ?? ""}
              columns={[
                { key: "family", label: section.kind === "unpaired" ? "Activity" : "Type family" },
                { key: "finances_amount", label: `Finances (${currency})`, kind: "amount" },
                { key: "data_kiosk_amount", label: `Data Kiosk (${currency})`, kind: "amount" },
                ...metric,
                { key: "coverage", label: "Source coverage" },
                ...(onSelectFamily ? [{ key: "focus", label: "Investigate" }] : []),
              ]}
              renderCell={(row, column) => renderFamilyCell(row, column, onSelectFamily)}
            />
          </section>
        );
      })}
    </Stack>
  );
}
