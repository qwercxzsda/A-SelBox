import type { CanonicalRow } from "./api/types.ts";
import { humanizeCode } from "./categories.ts";
import { formatRecordDate, parseRecordTimestamp } from "./date-display.ts";
import { formatAmount } from "./decimal.ts";

function metadataLabel(key: string): string {
  if (key === "id") return "Record ID";
  if (key === "seller_namespace") return "Source namespace";
  const label = humanizeCode(key).replace(/\b(id|sku|api|utc|asin)\b/gi, (word) =>
    word.toUpperCase(),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function metadataValue(key: string, value: string | null): string | null {
  if (value === null) return null;
  if (key === "fee_base") return formatAmount(value);
  if (key.endsWith("_at") && parseRecordTimestamp(value)) return formatRecordDate(value);
  if (key.startsWith("is_") || key === "email_confirmed" || key === "activity_eligible") {
    if (value === "true" || value === "t") return "Yes";
    if (value === "false" || value === "f") return "No";
  }
  return value;
}

/** Keep exact identifiers and source codes while presenting metadata with shared labels and UTC dates. */
export function recordMetadata(row: CanonicalRow, keys = Object.keys(row)): CanonicalRow[] {
  return keys.map((key) => ({
    field: metadataLabel(key),
    value: metadataValue(key, row[key] ?? null),
  }));
}
