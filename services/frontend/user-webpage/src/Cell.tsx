import "./Cell.css";
import type { CanonicalRow } from "./api";
import { humanizeCode } from "./categories";
import { TransactionTypeValue } from "./TransactionTypeValue";
import { formatExactDecimal, formatMoney } from "./decimal";
import { formatRecordDate, formatRecordMonth } from "./date-display";
import { companyLabel, type ColumnDefinition } from "./view-model";
import { TransactionTime } from "./TransactionTime";

function codeLabel(key: string, value: string): string {
  if (key === "activity_eligible") return value === "true" ? "Included" : "Exclusive";
  return humanizeCode(value);
}

interface TableCellValueProps {
  column: ColumnDefinition;
  companies: Map<string, string>;
  row: CanonicalRow;
}

export function TableCellValue(props: TableCellValueProps) {
  const secondary = props.column.secondary;
  if (!secondary) return <SingleCellValue {...props} />;
  return (
    <div className="stacked-cell-value">
      <span className="stacked-cell-primary">
        <SingleCellValue {...props} />
      </span>
      <span className="stacked-cell-secondary">
        {secondary.label}: <SingleCellValue {...props} column={secondary} />
      </span>
    </div>
  );
}

function SingleCellValue({ column, companies, row }: TableCellValueProps) {
  if (column.key === "activity_at") return <TransactionTime row={row} />;
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
      return row.access_role === "administrator" ? "All companies" : "Unassigned";
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
      return formatMoney(value, row.currency ?? null);
    case "percent":
      return `${formatExactDecimal(value)}%`;
    case "number":
      return formatExactDecimal(value);
    case "text":
      return value;
  }
}
