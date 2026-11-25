import "./Cell.css";
import type { CanonicalRow } from "./api";
import { invoiceStatusLabel, regionLabel } from "./amazon-codes";
import { humanizeCode } from "./categories";
import { TransactionTypeValue } from "./TransactionTypeValue";
import { formatExactDecimal, formatExactMoney, formatMoney } from "./decimal";
import { formatRecordMonth } from "./date-display";
import { parseCsvBoolean } from "./api/csv-boolean";
import { ListRowName } from "./ListRowName";
import { RecordTimestamp } from "./RecordTimestamp";
import type { ColumnDefinition } from "./table-columns";
import { companyLabel } from "./view-model";
import { TransactionTime } from "./TransactionTime";

function codeLabel(key: string, value: string): string {
  if (key === "activity_eligible") return value === "true" ? "Included" : "Excluded";
  return humanizeCode(value);
}

interface TableCellValueProps {
  column: ColumnDefinition;
  companies: Map<string, string>;
  row: CanonicalRow;
}

export function TableCellValue(props: TableCellValueProps) {
  const { secondary, note } = props.column;
  const beneath = secondary ? (
    <>
      {secondary.label}: <SingleCellValue {...props} column={secondary} />
    </>
  ) : (
    (note?.(props.row) ?? null)
  );
  if (beneath === null) return <SingleCellValue {...props} />;
  return (
    <div className="stacked-cell-value">
      <span className="stacked-cell-primary">
        <SingleCellValue {...props} />
      </span>
      <span className="stacked-cell-secondary">{beneath}</span>
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
      if (row.outcome === "SELBOX") return "SelBox";
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
      return value ? <RecordTimestamp value={value} /> : "—";
    case "name":
      return <ListRowName>{value}</ListRowName>;
    case "yes-no":
      return parseCsvBoolean(value, column.key) ? "Yes" : "No";
    case "month":
      return <time dateTime={value.slice(0, 7)}>{formatRecordMonth(value)}</time>;
    case "money":
      return formatMoney(value, row.currency ?? null);
    case "exact-money":
      return formatExactMoney(value, row.currency ?? null);
    case "region":
      return regionLabel(value);
    case "invoice-status":
      return invoiceStatusLabel(value);
    case "period": {
      const end = column.endKey ? row[column.endKey] : null;
      return end ? `${value} – ${end}` : value;
    }
    case "percent":
      return `${formatExactDecimal(value)}%`;
    case "number":
      return formatExactDecimal(value);
    case "text":
      return value;
  }
}
