import type { CanonicalRow } from "./types.ts";
import { parseCsvBoolean } from "./csv-boolean.ts";
import { parseRecordTimestamp } from "../date-display.ts";

/** User access shows these facts as they are; reject a row that breaks the directory's contract. */
export function validateAccountDirectoryRow(row: CanonicalRow): void {
  parseCsvBoolean(row.email_confirmed, "email_confirmed");
  if (!row.created_at || !parseRecordTimestamp(row.created_at))
    throw new Error("Data response has an invalid created_at");
}
