import { Button, Group, Text } from "@mantine/core";
import type { InventoryViewState } from "./workspace-view-state";
import { recommendationLabel } from "./inventory-options";

export function InventoryAppliedFilters({
  state,
  onChange,
}: {
  state: InventoryViewState;
  onChange: (patch: Partial<InventoryViewState>) => void;
}) {
  const filters = [
    ...(state.search
      ? [{ key: "search", label: `Search: ${state.search}`, clear: { search: "" } }]
      : []),
    ...(state.marketplace
      ? [
          {
            key: "marketplace",
            label: `Marketplace: ${state.marketplace}`,
            clear: { marketplace: "" },
          },
        ]
      : []),
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
      label: `Recommendation: ${action === null ? "Unavailable" : recommendationLabel(action)}`,
      clear: { recommendations: state.recommendations.filter((value) => value !== action) },
    })),
  ];
  if (filters.length === 0) return null;
  return (
    <Group gap="xs" role="group" aria-label="Applied inventory filters">
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
          onClick={() => {
            onChange(clear);
          }}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
