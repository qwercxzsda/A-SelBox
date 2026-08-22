export function sanitizeSearchTerm(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\\",().*%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
