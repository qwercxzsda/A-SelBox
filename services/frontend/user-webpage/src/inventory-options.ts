import type { InventoryFilterOptions, InventorySearchValues } from "./api/inventory.ts";
import type { FilterOption } from "./filter-options.ts";
import marketplaces from "./generated/marketplaces.json" with { type: "json" };

const normalizeStatus = (value: string | null) =>
  value?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ?? "";

// Application priorities match latest_inventory_items; Amazon provides the original labels.
const HEALTH_URGENCY = new Map([
  ["outofstock", 40],
  ["lowstock", 30],
  ["excess", 20],
  ["excessstock", 20],
  ["excessinventory", 20],
  ["highstock", 20],
  ["overstock", 20],
  ["healthy", 0],
]);
const RECOMMENDATIONS = new Map([
  ["editlisting", { label: "Edit listing", tone: "listing", urgency: 50 }],
  ["gotorestock", { label: "Restock", tone: "restock", urgency: 40 }],
  ["restock", { label: "Restock", tone: "restock", urgency: 40 }],
  ["restockinventory", { label: "Restock", tone: "restock", urgency: 40 }],
  ["sendtofba", { label: "Send to FBA", tone: "shipment", urgency: 30 }],
  ["advertiselisting", { label: "Advertise listing", tone: "unknown", urgency: 20 }],
  ["noexcessinventory", { label: "No excess inventory", tone: "unknown", urgency: 0 }],
  ["noactionrequired", { label: "No action required", tone: "unknown", urgency: 0 }],
]);

export const recommendationLabel = (value: string | null) =>
  value === null ? "Unavailable" : (RECOMMENDATIONS.get(normalizeStatus(value))?.label ?? value);
export const recommendationTone = (value: string | null) =>
  RECOMMENDATIONS.get(normalizeStatus(value))?.tone ?? "unknown";

/** Encode nullable values without reserving a string that Amazon could legitimately report. */
export function inventoryFilterOptions(
  values: readonly (string | null)[],
  selected: readonly (string | null)[],
  column: "sku" | "health_status" | "recommended_action" = "sku",
): FilterOption[] {
  const label = (value: string | null) =>
    column === "recommended_action" ? recommendationLabel(value) : (value ?? "Unavailable");
  const urgency = (value: string | null) =>
    column === "health_status"
      ? (HEALTH_URGENCY.get(normalizeStatus(value)) ?? null)
      : column === "recommended_action"
        ? (RECOMMENDATIONS.get(normalizeStatus(value))?.urgency ?? null)
        : null;
  return [...new Set([...values, ...selected])]
    .sort((left, right) => {
      const leftUrgency = urgency(left);
      const rightUrgency = urgency(right);
      if (leftUrgency !== rightUrgency) {
        if (leftUrgency === null) return 1;
        if (rightUrgency === null) return -1;
        return rightUrgency - leftUrgency;
      }
      return label(left).localeCompare(label(right));
    })
    .map((value) => ({
      value: JSON.stringify(value),
      label: label(value),
      title: value ?? "No value in the source report",
    }));
}

export function resolveInventorySearch(
  search: string,
  options: InventoryFilterOptions,
): InventorySearchValues | null {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return null;
  const matches = (raw: string | null, label = raw ?? "Unavailable") =>
    (raw ?? "").toLocaleLowerCase().includes(term) || label.toLocaleLowerCase().includes(term);
  return {
    skus: options.skus.filter((value) => matches(value)),
    health_statuses: options.health_statuses.filter((value) => matches(value)),
    recommendations: options.recommendations.filter((value) =>
      matches(value, recommendationLabel(value)),
    ),
    marketplaces: marketplaces.filter((value) => matches(value)),
  };
}
