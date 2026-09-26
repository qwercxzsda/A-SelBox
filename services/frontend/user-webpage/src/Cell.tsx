import "./Cell.css";
import type { CanonicalRow } from "./api";
import { humanizeCode, transactionTypeLabel } from "./categories";
import { formatExactDecimal, formatExactMoney } from "./decimal";
import { companyLabel, type ColumnDefinition } from "./view-model";

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
    if (column.kind === "company")
      return row.access_role === "operator" ? "All companies" : "Unassigned";
    return <span className="muted-value">—</span>;
  }
  switch (column.kind) {
    case "code":
      return (
        <span
          className={value.startsWith("MISSING_") ? "missing-value" : undefined}
          title={column.key === "component_type" ? value : undefined}
        >
          {column.key === "component_type" ? transactionTypeLabel(value) : humanizeCode(value)}
        </span>
      );
    case "company":
      return companyLabel(value, companies);
    case "date":
      return value || "—";
    case "period": {
      const match = /^\[([^,]+),([^)]*)\)$/.exec(value);
      return match ? `${match[1]} → ${match[2] || "No end date"}` : value;
    }
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
