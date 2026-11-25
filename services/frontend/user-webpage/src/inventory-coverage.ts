import type { InventoryCapture } from "./api/inventory.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { parseRecordTimestamp } from "./date-display.ts";
import timeZones from "./generated/marketplace-timezones.json" with { type: "json" };

const INVENTORY_OVERDUE_DAYS = 2;
/** The one wording of the age rule, shared by the Inventory help and each date's tooltip. */
export const INVENTORY_OUT_OF_DATE_RULE = `Out of date: more than ${String(INVENTORY_OVERDUE_DAYS)} days old in the marketplace's time zone.`;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function marketplaceTimeZone(marketplace: string): string | null {
  return Object.hasOwn(timeZones, marketplace)
    ? timeZones[marketplace as keyof typeof timeZones]
    : null;
}

function marketplaceDay(timestamp: number, marketplace: string): string | null {
  const instant = new Date(timestamp);
  const timeZone = marketplaceTimeZone(marketplace);
  if (!Number.isFinite(instant.getTime()) || timeZone === null) return null;
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function inventorySourceDay(value: string | null, marketplace: string): string | null {
  if (value === null || marketplaceTimeZone(marketplace) === null) return null;
  const day = value.slice(0, 10);
  try {
    requireCalendarDate(day);
  } catch {
    return null;
  }
  if (value === day) return day;
  const timestamp = parseRecordTimestamp(value);
  return timestamp ? marketplaceDay(timestamp.getTime(), marketplace) : null;
}

export function inventoryAge(day: string | null, now: number, marketplace: string) {
  const validDay = inventorySourceDay(day, marketplace);
  const today = marketplaceDay(now, marketplace);
  if (validDay === null || today === null) return { label: "Date unavailable", overdue: false };
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${validDay}T00:00:00Z`)) / 86_400_000;
  if (days < 0) return { label: "Future date", overdue: false };
  return {
    label: days === 0 ? "Today" : `${String(days)} ${days === 1 ? "day" : "days"} old`,
    overdue: days > INVENTORY_OVERDUE_DAYS,
  };
}

export function inventoryEmptyMessage({
  captures,
  marketplaces,
  hasItems,
  member,
}: {
  captures: InventoryCapture[] | undefined;
  marketplaces: string[];
  hasItems: boolean | undefined;
  member: boolean;
}): string {
  if (captures === undefined) return "Checking inventory…";
  const covered = captures.some(
    (capture) => !marketplaces.length || marketplaces.includes(capture.marketplace_name),
  );
  if (!covered)
    return marketplaces.length === 1
      ? `No inventory snapshot for ${marketplaces[0]} yet`
      : marketplaces.length
        ? "No inventory snapshots for these marketplaces yet"
        : "No inventory snapshots yet";
  if (hasItems === undefined) return "Checking inventory…";
  if (hasItems) return "No matching inventory";
  return member
    ? "No inventory for your company's SKUs"
    : "The latest snapshots have no items here";
}
