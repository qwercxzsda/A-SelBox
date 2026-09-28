import "./Cell.css";
import type { CanonicalRow } from "./api";
import { allocationCategoryLabel, humanizeCode, transactionTypeLabel } from "./categories";
import { formatExactDecimal, formatExactMoney } from "./decimal";
import { companyLabel, type ColumnDefinition } from "./view-model";

function codeLabel(key: string, value: string): string {
  if (key === "component_type") return transactionTypeLabel(value);
  if (key === "category") return allocationCategoryLabel(value);
  return humanizeCode(value);
}

export function TableCellValue({
  column,
  companies,
  row,
}: {
  column: ColumnDefinition;
  companies: Map<string, string>;
  row: CanonicalRow;
}) {
  if (
    row.resolution_status === "NOT_APPLICABLE" &&
    (column.key === "fee_rate_percent" || column.key === "fee_amount")
  ) {
    return (
      <span className="muted-value" title="Fee not applicable">
        -
      </span>
    );
  }
  const value = row[column.key] ?? null;
  if (value === null) {
    if (column.kind === "company") {
      if (row.category === "SELBOX") return "SelBox";
      return row.access_role === "operator" ? "All companies" : "Unassigned";
    }
    return <span className="muted-value">—</span>;
  }
  switch (column.kind) {
    case "code":
      return (
        <span
          className={value.startsWith("MISSING_") ? "missing-value" : undefined}
          title={column.key === "component_type" ? value : undefined}
        >
          {codeLabel(column.key, value)}
        </span>
      );
    case "company":
      return companyLabel(value, companies);
    case "date":
      return value || "—";
    case "money":
      return formatExactMoney(value, row.currency ?? null);
    case "percent":
      return `${formatExactDecimal(value)}%`;
    case "number":
      return formatExactDecimal(value);
    case "text":
      return value;
  }
}
