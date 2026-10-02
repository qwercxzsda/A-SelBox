import "./Cell.css";
import type { CanonicalRow } from "./api";
import { allocationCategoryLabel, humanizeCode } from "./categories";
import { TransactionTypeValue } from "./TransactionTypeValue";
import { formatExactDecimal, formatExactMoney } from "./decimal";
import { formatRecordDate, formatRecordMonth } from "./date-display";
import { companyLabel, type ColumnDefinition } from "./view-model";

function codeLabel(key: string, value: string): string {
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
  if (row.resolution_status === "NOT_APPLICABLE" && column.key === "fee_rate_percent") {
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
      if (column.key === "component_type") return <TransactionTypeValue value={value} />;
      return (
        <span className={value.startsWith("MISSING_") ? "missing-value" : undefined}>
          {codeLabel(column.key, value)}
        </span>
      );
    case "company":
      return companyLabel(value, companies);
    case "date":
      return value ? (
        <time dateTime={value} title={value}>
          {formatRecordDate(value)}
        </time>
      ) : (
        "—"
      );
    case "month":
      return <time dateTime={value.slice(0, 7)}>{formatRecordMonth(value)}</time>;
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
