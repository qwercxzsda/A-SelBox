const EM_DASH = "—";
// PostgreSQL numeric supports up to 131,072 digits before and 16,383 digits
// after the decimal point. Keep the entire exact database output representable.
const MAX_EXPANDED_DIGITS = 131_072 + 16_383;
const DECIMAL_TEXT_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?)(\d+))?$/;
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

interface DecimalParts {
  fraction: string;
  integer: string;
  negative: boolean;
}

function parseExponentShift(sign: string | undefined, digits: string | undefined): number | null {
  if (digits === undefined) {
    return 0;
  }

  let magnitude = 0;
  for (const digit of digits) {
    magnitude = magnitude * 10 + digit.charCodeAt(0) - 48;
    if (magnitude > MAX_EXPANDED_DIGITS) {
      return null;
    }
  }

  return sign === "-" ? -magnitude : magnitude;
}

function trimLeadingIntegerZeros(value: string): string {
  return value.replace(/^0+/, "") || "0";
}

function trimTrailingFractionZeros(value: string): string {
  return value.replace(/0+$/, "");
}

function expandDecimal(
  integerDigits: string,
  fractionDigits: string,
  shift: number,
): Pick<DecimalParts, "fraction" | "integer"> | null {
  const digits = `${integerDigits}${fractionDigits}`;
  if (digits.length > MAX_EXPANDED_DIGITS) {
    return null;
  }

  const decimalIndex = integerDigits.length + shift;
  let integer: string;
  let fraction: string;

  if (decimalIndex <= 0) {
    const leadingFractionZeros = -decimalIndex;
    if (leadingFractionZeros + digits.length > MAX_EXPANDED_DIGITS) {
      return null;
    }
    integer = "0";
    fraction = `${"0".repeat(leadingFractionZeros)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    if (decimalIndex > MAX_EXPANDED_DIGITS) {
      return null;
    }
    integer = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    fraction = "";
  } else {
    integer = digits.slice(0, decimalIndex);
    fraction = digits.slice(decimalIndex);
  }

  return {
    fraction: trimTrailingFractionZeros(fraction),
    integer: trimLeadingIntegerZeros(integer),
  };
}

function parseDecimal(value: string | null): DecimalParts | null {
  if (value === null) {
    return null;
  }

  const match = DECIMAL_TEXT_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const sign = match.at(1);
  const whole = match.at(2);
  const fractionAfterWhole = match.at(3);
  const fractionWithoutWhole = match.at(4);
  const exponentSign = match.at(5);
  const exponentDigits = match.at(6);
  const integerDigits = whole ?? "0";
  const fractionDigits = fractionAfterWhole ?? fractionWithoutWhole ?? "";
  const coefficientDigits = `${integerDigits}${fractionDigits}`;

  if (!/[1-9]/.test(coefficientDigits)) {
    return { fraction: "", integer: "0", negative: false };
  }

  const shift = parseExponentShift(exponentSign, exponentDigits);
  if (shift === null) {
    return null;
  }

  const expanded = expandDecimal(integerDigits, fractionDigits, shift);
  return expanded === null
    ? null
    : {
        ...expanded,
        negative: sign === "-",
      };
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatParts(parts: DecimalParts): string {
  const groupedInteger = groupIntegerDigits(parts.integer);
  const unsigned = parts.fraction ? `${groupedInteger}.${parts.fraction}` : groupedInteger;
  return parts.negative ? `-${unsigned}` : unsigned;
}

function normalizeCurrency(currency: string | null): string | null {
  if (currency === null) {
    return null;
  }

  const code = currency.trim().toUpperCase();
  return ISO_CURRENCY_PATTERN.test(code) ? code : null;
}

export function formatExactDecimal(value: string | null): string {
  const parts = parseDecimal(value);
  return parts === null ? EM_DASH : formatParts(parts);
}

export function formatExactMoney(value: string | null, currency: string | null): string {
  const parts = parseDecimal(value);
  const currencyCode = normalizeCurrency(currency);
  return parts === null || currencyCode === null
    ? EM_DASH
    : `${formatParts(parts)} ${currencyCode}`;
}

export function formatExactQuantity(value: string | null): string {
  return formatExactDecimal(value);
}

export function isNonZeroDecimal(value: string | null): boolean {
  const parts = parseDecimal(value);
  return parts !== null && (parts.integer !== "0" || /[1-9]/.test(parts.fraction));
}
