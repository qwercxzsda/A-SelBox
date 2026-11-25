/** PostgREST CSV writes a boolean as "t" or "f"; any other value breaks the read contract. */
export function parseCsvBoolean(value: string | null | undefined, field: string): boolean {
  if (value === "t") return true;
  if (value === "f") return false;
  throw new Error(`Data response has an invalid ${field}`);
}
