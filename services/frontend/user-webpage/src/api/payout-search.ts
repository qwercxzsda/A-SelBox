import type { ApiTransport } from "./transport.ts";
import { readAllCsvRows } from "./pagination.ts";
import { readStableSnapshot } from "./snapshot.ts";
import { requireCalendarDate, quotePostgrestText } from "./filters.ts";
import { formatRecordMonth } from "../date-display.ts";
import { buildSearchFilter } from "./search.ts";

/** Resolve display text in the browser; the database filters only exact stored dates. */
export async function payoutSearchFilter(
  transport: ApiTransport,
  accessToken: string,
  search: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return null;
  const references = await readStableSnapshot(
    transport,
    { accessToken, sources: ["payouts"], operation: "Payout months", signal },
    () =>
      readAllCsvRows(transport, {
        accessToken,
        signal,
        endpoint: "latest_company_payout_reports",
        columns: ["id", "start_date"],
        order: "id.asc",
        operation: "Payout months",
        decode: (row) => {
          if (!row.id || !row.start_date) throw new Error("Payout month references are incomplete");
          requireCalendarDate(row.start_date);
          return { id: row.id, start_date: row.start_date };
        },
        identity: (row) => row.id,
      }),
  );
  const dates = new Set(
    references
      .filter((row) =>
        [formatRecordMonth(row.start_date), row.start_date.slice(0, 7)].some((label) =>
          label.toLocaleLowerCase().includes(term),
        ),
      )
      .map((row) => row.start_date),
  );
  const text = (buildSearchFilter(["marketplace_name", "currency"], search) ?? "()").slice(1, -1);
  return `(${text}${dates.size ? `,start_date.in.(${[...dates].sort().map(quotePostgrestText).join(",")})` : ""})`;
}
