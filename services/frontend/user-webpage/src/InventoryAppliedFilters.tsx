import { Button, Group, Text } from "@mantine/core";
import type { RefObject } from "react";
import type { InventoryViewState } from "./workspace-view-state";
import { recommendationLabel } from "./inventory-options";
import { companyLabel } from "./view-model";

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
  if (filters.length === 0) return null;
  return (
    <Group gap="xs" mb="sm" role="group" aria-label="Applied inventory filters">
      <Text size="xs" c="dimmed">
        Applied filters
      </Text>
      {filters.map(({ key, label, clear }) => (
        <Button
          key={key}
          className="inventory-filter-chip"
          size="compact-xs"
          variant="light"
          aria-label={`Remove ${label}`}
          rightSection={<span aria-hidden="true">×</span>}
          onClick={(event) => {
            if (event.detail === 0) focusTarget?.current?.focus();
            onChange(clear);
          }}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
