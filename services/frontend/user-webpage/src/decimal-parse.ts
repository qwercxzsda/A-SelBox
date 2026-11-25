// Exact decimal text is parsed to digit strings, so amounts never pass through Number.
// PostgreSQL numeric supports up to 131,072 digits before and 16,383 digits
// after the decimal point. Keep the entire exact database output representable.
const MAX_EXPANDED_DIGITS = 131_072 + 16_383;
const DECIMAL_TEXT_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?)(\d+))?$/;

export interface DecimalParts {
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

export function parseDecimal(value: string | null): DecimalParts | null {
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

export function formatParts(parts: DecimalParts): string {
  const groupedInteger = groupIntegerDigits(parts.integer);
  const unsigned = parts.fraction ? `${groupedInteger}.${parts.fraction}` : groupedInteger;
  return parts.negative ? `-${unsigned}` : unsigned;
}
