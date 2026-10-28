import type { FeeFamily, FeeFamilySource } from "./fee-family-catalog.ts";
import type { CanonicalRow } from "./api/types.ts";

interface FinancialReviewCoverage {
  financesRowCount: string | null;
  dataKioskRowCount: string | null;
  monthCount: number;
  months: {
    onlyFinances: number;
    onlyDataKiosk: number;
    both: number;
    noRecords: number;
    unknownCounts: number;
  };
}

function recordCount(value: unknown): bigint | null {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
}

/** Each row represents one validated month in the same review scope. */
export function buildFinancialReviewCoverage(
  rows: readonly CanonicalRow[],
): FinancialReviewCoverage {
  const months = { onlyFinances: 0, onlyDataKiosk: 0, both: 0, noRecords: 0, unknownCounts: 0 };
  let financesTotal: bigint | null = 0n;
  let dataKioskTotal: bigint | null = 0n;
  for (const row of rows) {
    const finances = recordCount(row.finances_row_count);
    const dataKiosk = recordCount(row.data_kiosk_row_count);
    financesTotal = financesTotal === null || finances === null ? null : financesTotal + finances;
    dataKioskTotal =
      dataKioskTotal === null || dataKiosk === null ? null : dataKioskTotal + dataKiosk;
    if (finances === null || dataKiosk === null) months.unknownCounts++;
    else if (finances > 0n && dataKiosk > 0n) months.both++;
    else if (finances > 0n) months.onlyFinances++;
    else if (dataKiosk > 0n) months.onlyDataKiosk++;
    else months.noRecords++;
  }
  return {
    financesRowCount: financesTotal?.toString() ?? null,
    dataKioskRowCount: dataKioskTotal?.toString() ?? null,
    monthCount: rows.length,
    months,
  };
}

interface FamilyCoverageRow {
  month: string;
  source: string;
  rowCount: bigint;
}

/** Definition-only families are distinct from a paired family with an absent source. */
export function describeFeeFamilyCoverage(
  rows: readonly FamilyCoverageRow[],
  definition: Pick<FeeFamily, "financesTypes" | "dataKioskTypes">,
): string {
  const hasFinances = definition.financesTypes.length > 0;
  const hasDataKiosk = definition.dataKioskTypes.length > 0;
  if (!hasFinances && !hasDataKiosk) return "Source availability unknown";
  if (!hasFinances) return "Data Kiosk-only family";
  if (!hasDataKiosk) return "Finances-only family";

  const months = new Map<string, Set<FeeFamilySource>>();
  for (const row of rows) {
    if (
      typeof row.month !== "string" ||
      !row.month ||
      (row.source !== "FINANCES" && row.source !== "DATA_KIOSK") ||
      typeof row.rowCount !== "bigint" ||
      row.rowCount < 0n
    )
      return "Source availability unknown";
    if (row.rowCount === 0n) continue;
    const sources = months.get(row.month) ?? new Set<FeeFamilySource>();
    sources.add(row.source);
    months.set(row.month, sources);
  }
  const sourceMonths = [...months.values()];
  if (!sourceMonths.length) return "No source rows in this scope";
  if (!sourceMonths.some((sources) => sources.has("FINANCES")))
    return "No Finances rows in this scope";
  if (!sourceMonths.some((sources) => sources.has("DATA_KIOSK")))
    return "No Data Kiosk rows in this scope";
  if (sourceMonths.length === 1) return "Both sources";
  const both = sourceMonths.filter((sources) => sources.size === 2).length;
  return `Both sources in ${String(both)} of ${String(sourceMonths.length)} months`;
}
