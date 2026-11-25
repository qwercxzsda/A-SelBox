import { SELBOX_GROUPS } from "./api/financial-review.ts";
import type { CanonicalRow } from "./api/types.ts";
import { knownCode } from "./api/validation.ts";
import { humanizeCode, SELBOX_GROUP_LABELS } from "./categories.ts";
import { formatRecordDate, parseRecordTimestamp } from "./date-display.ts";
import { formatExactMoney, formatMoney } from "./decimal.ts";

export interface RecordMetadataOptions {
  /** Raw data shows every digit of an amount; other lists round to cents. */
  exactAmounts?: boolean;
}

function isTimestamp(key: string, value: string | null): value is string {
  return key.endsWith("_at") && value !== null && parseRecordTimestamp(value) !== null;
}

function metadataLabel(key: string): string {
  if (key === "id") return "Record ID";
  if (key === "seller_namespace") return "Seller account";
  const label = humanizeCode(key)
    .replace(/\b(id|sku|fnsku|api|utc|asin)\b/gi, (word) => word.toUpperCase())
    .replace(/\bselbox\b/gi, "SelBox");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function metadataValue(
  key: string,
  value: string | null,
  currency: string | null,
  { exactAmounts = false }: RecordMetadataOptions,
): string | null {
  if (value === null) return null;
  if (key === "selbox_group")
    return SELBOX_GROUP_LABELS[knownCode(SELBOX_GROUPS, value, "SelBox group")];
  if (key === "fee_base")
    return exactAmounts ? formatExactMoney(value, currency) : formatMoney(value, currency);
  if (isTimestamp(key, value)) return formatRecordDate(value, { includeTimeZone: false });
  if (key.startsWith("is_") || key === "email_confirmed" || key === "activity_eligible") {
    if (value === "true" || value === "t") return "Yes";
    if (value === "false" || value === "f") return "No";
  }
  return value;
}

/** Keep exact identifiers and source codes; timestamp labels carry "(UTC)" instead of their values. */
export function recordMetadata(
  row: CanonicalRow,
  keys = Object.keys(row),
  options: RecordMetadataOptions = {},
): CanonicalRow[] {
  const currency = row.currency ?? null;
  return keys.map((key) => {
    const value = row[key] ?? null;
    const label = metadataLabel(key);
    return {
      field: isTimestamp(key, value) ? `${label} (UTC)` : label,
      value: metadataValue(key, value, currency, options),
    };
  });
}
