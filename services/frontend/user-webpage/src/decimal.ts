import { formatParts, parseDecimal, type DecimalParts } from "./decimal-parse.ts";

const EM_DASH = "—";
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

function normalizeCurrency(currency: string | null): string | null {
  if (currency === null) {
    return null;
  }

  const code = currency.trim().toUpperCase();
  return ISO_CURRENCY_PATTERN.test(code) ? code : null;
}

/** Exact decimal text, as PostgreSQL numeric or Amazon's reports print it. */
export function isDecimal(value: string): boolean {
  return parseDecimal(value) !== null;
}

export function formatExactDecimal(value: string | null): string {
  const parts = parseDecimal(value);
  return parts === null ? EM_DASH : formatParts(parts);
}

/** Compare magnitudes exactly, including values beyond JavaScript's number precision. */
export function compareAbsoluteDecimals(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = parseDecimal(left ?? null);
  const b = parseDecimal(right ?? null);
  if (!a || !b) throw new Error("Cannot compare invalid decimal amounts");
  if (a.integer.length !== b.integer.length) return a.integer.length < b.integer.length ? -1 : 1;
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(scale, "0");
  const bFraction = b.fraction.padEnd(scale, "0");
  return aFraction === bFraction ? 0 : aFraction < bFraction ? -1 : 1;
}

/** Compare signed amounts exactly without losing precision to JavaScript numbers. */
export function compareDecimals(left: string, right: string): number {
  const a = parseDecimal(left),
    b = parseDecimal(right);
  if (!a || !b) throw new Error("Cannot compare invalid decimal amounts");
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const magnitude = compareAbsoluteDecimals(left, right);
  return a.negative ? -magnitude : magnitude;
}

/** Round monetary display to cents, with decimal ties away from zero. */
function roundAmount(parts: DecimalParts): DecimalParts {
  let cents = BigInt(parts.integer + parts.fraction.slice(0, 2).padEnd(2, "0"));
  if ((parts.fraction.at(2) ?? "0") >= "5") cents += 1n;
  const digits = cents.toString().padStart(3, "0");
  return {
    integer: digits.slice(0, -2),
    fraction: digits.slice(-2),
    negative: parts.negative && cents !== 0n,
  };
}

export function formatAmount(value: string | null): string {
  const parts = parseDecimal(value);
  return parts === null ? EM_DASH : formatParts(roundAmount(parts));
}

/** A zero needs no currency: Amazon prints some zero fees, such as a removal fee, without one. */
const isZero = (parts: DecimalParts) => parts.integer === "0" && parts.fraction === "";

export function formatMoney(value: string | null, currency: string | null): string {
  const parts = parseDecimal(value);
  if (parts !== null && currency === null && isZero(parts)) return "0.00";
  const currencyCode = normalizeCurrency(currency);
  return parts === null || currencyCode === null
    ? EM_DASH
    : `${formatParts(roundAmount(parts))} ${currencyCode}`;
}

const minorUnitsByCurrency = new Map<string, number>();

/** ISO 4217 minor units, e.g. 2 for USD and 0 for JPY. */
function currencyMinorUnits(code: string): number {
  const known = minorUnitsByCurrency.get(code);
  if (known !== undefined) return known;
  const { maximumFractionDigits } = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).resolvedOptions();
  if (maximumFractionDigits === undefined) throw new Error(`No minor units for ${code}`);
  minorUnitsByCurrency.set(code, maximumFractionDigits);
  return maximumFractionDigits;
}

/**
 * The exact amount, padded to the currency's minor units and never rounded, so sub-cent
 * values stay visible ("-1,000.50", "-0.0002"). Financial review and Raw data use it. A zero
 * without a currency is "0"; any other amount without a valid currency is unknown ("—").
 */
export function formatExactAmount(value: string | null, currency: string | null): string {
  const parts = parseDecimal(value);
  if (parts === null) return EM_DASH;
  const code = normalizeCurrency(currency);
  if (code === null) return currency === null && isZero(parts) ? "0" : EM_DASH;
  return formatParts({ ...parts, fraction: parts.fraction.padEnd(currencyMinorUnits(code), "0") });
}

/** formatExactAmount followed by the currency code, for rows that do not share one currency. */
export function formatExactMoney(value: string | null, currency: string | null): string {
  const amount = formatExactAmount(value, currency);
  const code = normalizeCurrency(currency);
  return amount === EM_DASH || code === null ? amount : `${amount} ${code}`;
}

/** Add known decimal values without converting financial amounts to Number. */
export function sumExactDecimals(values: Iterable<string | null>): string | null {
  let total = 0n;
  let scale = 0;
  let hasValue = false;
  for (const value of values) {
    if (value === null) continue;
    const parts = parseDecimal(value);
    if (parts === null) throw new Error("Cannot sum an invalid decimal amount");
    hasValue = true;
    if (parts.fraction.length > scale) {
      total *= 10n ** BigInt(parts.fraction.length - scale);
      scale = parts.fraction.length;
    }
    const magnitude =
      BigInt(parts.integer + parts.fraction) * 10n ** BigInt(scale - parts.fraction.length);
    total += parts.negative ? -magnitude : magnitude;
  }
  if (!hasValue) return null;
  if (total === 0n) return "0";
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function differenceExact(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  const normalized = sumExactDecimals([right]);
  if (normalized === null) return null;
  return sumExactDecimals([
    left,
    normalized.startsWith("-") ? normalized.slice(1) : `-${normalized}`,
  ]);
}
