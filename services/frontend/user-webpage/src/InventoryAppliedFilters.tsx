import type { RefObject } from "react";
import type { InventoryViewState } from "./workspace-view-state";
import { recommendationLabel } from "./inventory-options";
import { companyLabel } from "./view-model";
import { AppliedFilterChips } from "./AppliedFilterChips";

export function InventoryAppliedFilters({
  state,
  companyNames,
  onChange,
  focusTarget,
}: {
  state: InventoryViewState;
  companyNames: Map<string, string>;
  onChange: (patch: Partial<InventoryViewState>) => void;
  focusTarget?: RefObject<HTMLElement | null>;
}) {
  const filters = [
    ...(state.search
      ? [{ key: "search", label: `Search: ${state.search}`, clear: { search: "" } }]
      : []),
    ...state.marketplaces.map((marketplace) => ({
      key: `marketplace:${marketplace}`,
      label: `Marketplace: ${marketplace}`,
      clear: { marketplaces: state.marketplaces.filter((value) => value !== marketplace) },
    })),
    ...state.companyIds.map((id) => ({
      key: `company:${JSON.stringify(id)}`,
      label: `Company: ${companyLabel(id, companyNames)}`,
      clear: { companyIds: state.companyIds.filter((value) => value !== id) },
    })),
    ...state.skus.map((sku) => ({
      key: `sku:${sku}`,
      label: `SKU: ${sku}`,
      clear: { skus: state.skus.filter((value) => value !== sku) },
    })),
    ...state.healthStatuses.map((status) => ({
      key: `health:${JSON.stringify(status)}`,
      label: `Health: ${status ?? "Unavailable"}`,
      clear: { healthStatuses: state.healthStatuses.filter((value) => value !== status) },
    })),
    ...state.recommendations.map((action) => ({
      key: `recommendation:${JSON.stringify(action)}`,
      label: `Recommendation: ${recommendationLabel(action)}`,
      clear: { recommendations: state.recommendations.filter((value) => value !== action) },
    })),
  ];
  return (
    <AppliedFilterChips
      label="Applied inventory filters"
      chips={filters}
      onChange={onChange}
      focusTarget={focusTarget}
    />
  );
}
