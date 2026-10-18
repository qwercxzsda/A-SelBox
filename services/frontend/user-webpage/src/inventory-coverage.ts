import type { InventoryCapture } from "./api/inventory.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { formatRecordDate } from "./date-display.ts";

export const INVENTORY_OVERDUE_DAYS = 2;

export function inventorySourceDay(value: string | null): string | null {
  if (value === null) return null;
  const day = formatRecordDate(value).slice(0, 10);
  try {
    requireCalendarDate(day);
    return day;
  } catch {
    return null;
  }
}

export function inventoryAge(day: string | null, now: number) {
  const validDay = inventorySourceDay(day);
  if (validDay === null) return { label: "Date unavailable", overdue: false };
  const today = new Date(now).toISOString().slice(0, 10);
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${validDay}T00:00:00Z`)) / 86_400_000;
  if (days < 0) return { label: "Future source date — check source", overdue: false };
  return {
    label: days === 0 ? "Today (UTC)" : `${String(days)} ${days === 1 ? "day" : "days"} old`,
    overdue: days > INVENTORY_OVERDUE_DAYS,
  };
}

export function inventoryReportRanges(captures: readonly InventoryCapture[], marketplace: string) {
  const reports = new Map<
    string,
    { marketplaceName: string; oldestDay: string | null; newestDay: string | null }
  >();
  for (const capture of captures) {
    if (marketplace && capture.marketplace_name !== marketplace) continue;
    const range = reports.get(capture.marketplace_name) ?? {
      marketplaceName: capture.marketplace_name,
      oldestDay: null,
      newestDay: null,
    };
    const day = inventorySourceDay(capture.report_created_at);
    if (day !== null) {
      if (range.oldestDay === null || day < range.oldestDay) range.oldestDay = day;
      if (range.newestDay === null || day > range.newestDay) range.newestDay = day;
    }
    reports.set(capture.marketplace_name, range);
  }
  return [...reports.values()].sort((left, right) =>
    left.marketplaceName < right.marketplaceName
      ? -1
      : left.marketplaceName > right.marketplaceName
        ? 1
        : 0,
  );
}

export function inventoryEmptyMessage({
  captures,
  marketplace,
  hasItems,
  member,
}: {
  captures: InventoryCapture[] | undefined;
  marketplace: string;
  hasItems: boolean | undefined;
  member: boolean;
}): string {
  if (captures === undefined)
    return "No inventory rows to show. Snapshot coverage has not been confirmed yet.";
  const covered = captures.some(
    (capture) => !marketplace || capture.marketplace_name === marketplace,
  );
  if (!covered)
    return marketplace
      ? `No inventory snapshot has been imported for ${marketplace}.`
      : "No inventory snapshots have been imported yet.";
  if (hasItems === undefined) return "Checking inventory availability before these filters…";
  if (hasItems) return "No inventory matches these filters.";
  return member
    ? "An inventory snapshot is available, but no items from it are assigned to your company."
    : "The latest imported snapshots contain no inventory items in this marketplace scope.";
}
