import type { FilterOption } from "./filter-options.ts";

// This vocabulary is agreed with preprocessing and protected by database CHECK constraints.
// Labels, visual tones, and relative priorities belong exclusively to the browser.
export const INVENTORY_HEALTH = {
  "Out of stock": { urgency: 40, tone: "critical" },
  "Low stock": { urgency: 30, tone: "attention" },
  Excess: { urgency: 20, tone: "neutral" },
  Healthy: { urgency: 0, tone: "healthy" },
} as const;
export const INVENTORY_RECOMMENDATIONS = {
  GoToRestock: { label: "Restock", tone: "replenishment", urgency: 50 },
  SendToFBA: { label: "Send to FBA", tone: "replenishment", urgency: 50 },
  CreateShippingPlan: { label: "Create shipping plan", tone: "replenishment", urgency: 50 },
  GoToStranded: { label: "Resolve stranded inventory", tone: "attention", urgency: 40 },
  "Edit listing": { label: "Edit listing", tone: "listing", urgency: 30 },
  "Lower price": { label: "Lower price", tone: "neutral", urgency: 20 },
  "Advertise listing": { label: "Advertise listing", tone: "neutral", urgency: 10 },
  NoExcessInventory: { label: "No excess inventory", tone: "neutral", urgency: 0 },
  NoRestockExcessActionRequired: {
    label: "No restock or excess action required",
    tone: "neutral",
    urgency: 0,
  },
} as const;
export type InventoryHealth = keyof typeof INVENTORY_HEALTH;
export type InventoryRecommendation = keyof typeof INVENTORY_RECOMMENDATIONS;
export const INVENTORY_HEALTH_VALUES = [...Object.keys(INVENTORY_HEALTH), null];
export const INVENTORY_RECOMMENDATION_VALUES = [...Object.keys(INVENTORY_RECOMMENDATIONS), null];

export const recommendationLabel = (value: string | null) =>
  value === null
    ? "Unavailable"
    : INVENTORY_RECOMMENDATIONS[value as InventoryRecommendation].label;
export const recommendationTone = (value: string | null) =>
  value === null ? "neutral" : INVENTORY_RECOMMENDATIONS[value as InventoryRecommendation].tone;
export const healthTone = (value: string | null) =>
  value === null ? "neutral" : INVENTORY_HEALTH[value as InventoryHealth].tone;
export const inventoryUrgency = (
  column: "health_status" | "recommended_action",
  value: string | null,
) =>
  value === null
    ? null
    : column === "health_status"
      ? INVENTORY_HEALTH[value as InventoryHealth].urgency
      : INVENTORY_RECOMMENDATIONS[value as InventoryRecommendation].urgency;

/** Null is an explicit source absence, distinct from any text value. */
export function inventoryFilterOptions(
  values: readonly (string | null)[],
  selected: readonly (string | null)[],
  column: "sku" | "health_status" | "recommended_action" = "sku",
): FilterOption[] {
  const label = (value: string | null) =>
    column === "recommended_action" ? recommendationLabel(value) : (value ?? "Unavailable");
  return [...new Set([...values, ...selected])]
    .sort((left, right) => {
      if (column !== "sku") {
        const a = inventoryUrgency(column, left),
          b = inventoryUrgency(column, right);
        if (a !== b) {
          if (a === null) return 1;
          if (b === null) return -1;
          return b - a;
        }
      }
      return label(left).localeCompare(label(right));
    })
    .map((value) => ({
      value: JSON.stringify(value),
      label: label(value),
      title: value ?? "No value in the source report",
    }));
}
