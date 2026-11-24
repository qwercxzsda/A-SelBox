import type { ApiTransport } from "./transport.ts";
import { requireCalendarDate, quotePostgrestText } from "./filters.ts";
import { formatRecordMonth } from "../date-display.ts";
import { buildSearchFilter } from "./search.ts";

/** Match browser-formatted labels against the distinct months visible to this account. */
export async function payoutSearchFilter(
  transport: ApiTransport,
  accessToken: string,
  search: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return null;
  const months = await transport.postRpc(
    accessToken,
    "payout_search_months",
    {},
    "Payout months",
    signal,
  );
  signal?.throwIfAborted();
  if (!Array.isArray(months)) throw new Error("Invalid payout months");
  const dates = months.filter((date: unknown): date is string => {
    if (typeof date !== "string") throw new Error("Invalid payout month");
    requireCalendarDate(date);
    return [formatRecordMonth(date), date.slice(0, 7)].some((label) =>
      label.toLocaleLowerCase().includes(term),
    );
  });
  return buildSearchFilter(
    ["marketplace_name", "currency"],
    search,
    dates.length ? [`start_date.in.(${dates.map(quotePostgrestText).join(",")})`] : [],
  );
}
