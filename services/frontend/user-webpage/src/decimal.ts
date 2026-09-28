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
  const firstGroupLength = value.length % 3 || 3;
  const groups = [value.slice(0, firstGroupLength)];
  for (let index = firstGroupLength; index < value.length; index += 3) {
    groups.push(value.slice(index, index + 3));
  }
  return groups.join(",");
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
  if (parts !== null && currency === null && parts.integer === "0" && parts.fraction === "")
    return "0";
  const currencyCode = normalizeCurrency(currency);
  return parts === null || currencyCode === null
    ? EM_DASH
    : `${formatParts(parts)} ${currencyCode}`;
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
