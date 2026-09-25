export function parseExactCount(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Data response has an invalid total count");
  }

  const total = Number(value);
  if (!Number.isSafeInteger(total)) {
    throw new Error("Data response total count exceeds JavaScript's safe range");
  }
  return total;
}

export function parseTotalCount(contentRange: string | null): number | null {
  if (contentRange === null) return null;
  const match = /^(?:\d+-\d+|\*)\/(\d+|\*)$/.exec(contentRange);
  if (!match) throw new Error("Data response has an invalid Content-Range header");
  return match[1] === "*" ? null : parseExactCount(match[1]);
}
