import type { CanonicalRow } from "./api";
import { categoryLabel, humanizeCode } from "./categories";
import { formatExactMoney } from "./decimal";
import { companyLabel, formatDate, rowText, type ColumnDefinition } from "./view-model";

export function CodeLabel({ code, category = false }: { code: string | null; category?: boolean }) {
  if (!code) {
    return <span className="muted-value">—</span>;
  }

  return (
    <span className="code-label">
      <strong>{category ? categoryLabel(code) : humanizeCode(code)}</strong>
      <code>{code}</code>
    </span>
  );
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
  const value = rowText(row, column.key);
  switch (column.kind) {
    case "category":
      return <CodeLabel category code={value} />;
    case "code":
      return <CodeLabel code={value} />;
    case "company":
      return companyLabel(value, companies);
    case "date":
      return formatDate(value);
    case "money":
      return formatExactMoney(value, rowText(row, "currency"));
    case "text":
      return value ?? <span className="muted-value">—</span>;
  }
}
