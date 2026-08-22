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
  if (typeof value !== "string") {
    throw new Error(`JSON response has invalid ${property}`);
  }
  return value;
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
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`JSON response has invalid ${property}`);
  }
  return value;
}
