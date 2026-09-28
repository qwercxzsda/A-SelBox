const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireUuid(value: unknown, label: string): void {
  if (!isUuid(value)) throw new Error(`A valid ${label} ID is required`);
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredJsonString(object: Record<string, unknown>, property: string): string {
  const value = object[property];
  if (typeof value !== "string") {
    throw new Error(`JSON response has invalid ${property}`);
  }
  return value;
}

export function optionalJsonString(
  object: Record<string, unknown>,
  property: string,
): string | undefined {
  const value = object[property];
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredJsonString(object, property);
}

export function requiredJsonNumber(object: Record<string, unknown>, property: string): number {
  const value = object[property];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`JSON response has invalid ${property}`);
  }
  return value;
}

export function optionalJsonNumber(
  object: Record<string, unknown>,
  property: string,
): number | undefined {
  const value = object[property];
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredJsonNumber(object, property);
}

export function parseObjectRows(value: unknown, operation: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new Error(`${operation} returned invalid rows`);
  }
  return value;
}
