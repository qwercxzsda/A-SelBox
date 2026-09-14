import type { CanonicalRow } from "./api";
import { humanizeCode } from "./categories";
import { formatExactDecimal, formatExactMoney } from "./decimal";
import { companyLabel, formatDate, rowText, type ColumnDefinition } from "./view-model";

export function TableCellValue({
  column,
  companies,
  row,
  skuNames = new Map(),
}: {
  column: ColumnDefinition;
  companies: Map<string, string>;
  row: CanonicalRow;
  skuNames?: Map<string, string>;
}) {
  const value = rowText(row, column.key);
  if (value === null) {
    if (column.kind === "company")
      return row.access_role === "operator" ? "All companies" : "Unassigned";
    return <span className="muted-value">—</span>;
  }
  switch (column.kind) {
    case "category":
    case "code":
      return (
        <span className={value.startsWith("MISSING_") ? "missing-value" : undefined}>
          {humanizeCode(value)}
        </span>
      );
    case "company":
      return companyLabel(value, companies);
    case "sku":
      return skuNames.get(value) ?? value;
    case "date":
      return formatDate(value);
    case "period": {
      const match = /^\[([^,]+),([^)]*)\)$/.exec(value);
      return match ? `${match[1]} → ${match[2] || "No end date"}` : value;
    }
    case "money":
      return formatExactMoney(value, rowText(row, "currency"));
    case "percent":
      return `${formatExactDecimal(value)}%`;
    case "number":
      return formatExactDecimal(value);
    case "text":
      return column.key === "authoritative"
        ? value === "true" || value === "t"
          ? "Yes"
          : "Comparison only"
        : value;
  }
}
