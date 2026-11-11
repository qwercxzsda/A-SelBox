import { Button, Group, Text } from "@mantine/core";
import type { RefObject } from "react";
import { ColumnMenu } from "./ColumnMenu";
import { FEE_STATUS_LABELS, type FeeStatus } from "./fee-status";
import type { FeeViewState } from "./workspace-view-state";
import { companyLabel } from "./view-model";

type FeeFilters = Pick<FeeViewState, "companyIds" | "marketplaces" | "statuses">;
interface FeeFilterProps {
  filters: FeeFilters;
  companies: Map<string, string>;
  onChange: (patch: Partial<FeeFilters>) => void;
}

export function FeeFilterHeader({
  field,
  filters,
  companies,
  marketplaces,
  statusOptions,
  onChange,
}: FeeFilterProps & {
  field: keyof FeeFilters;
  marketplaces: string[];
  statusOptions: readonly FeeStatus[];
}) {
  const label = { companyIds: "Company", marketplaces: "Marketplaces", statuses: "Status" }[field];
  const options =
    field === "companyIds"
      ? [...new Set([...companies.keys(), ...filters.companyIds, null])]
          .map((id) => ({ value: JSON.stringify(id), label: companyLabel(id, companies) }))
          .sort((left, right) => left.label.localeCompare(right.label))
      : field === "marketplaces"
        ? [...new Set([...marketplaces, ...filters.marketplaces])]
            .sort()
            .map((value) => ({ value, label: value }))
        : statusOptions.map((value) => ({ value, label: FEE_STATUS_LABELS[value] }));
  return (
    <ColumnMenu
      label={label}
      filter={{
        kind: "selection",
        value:
          field === "companyIds"
            ? filters.companyIds.map((id) => JSON.stringify(id))
            : filters[field],
        options,
        onChange: (values) => {
          if (field === "companyIds")
            onChange({ companyIds: values.map((value) => JSON.parse(value) as string | null) });
          else if (field === "marketplaces") onChange({ marketplaces: values });
          else onChange({ statuses: statusOptions.filter((value) => values.includes(value)) });
        },
      }}
    />
  );
}

export function AppliedFeeFilters({
  filters,
  companies,
  onChange,
  focusTarget,
}: FeeFilterProps & { focusTarget: RefObject<HTMLInputElement | null> }) {
  const chips = [
    ...filters.companyIds.map((id) => ({
      key: `company:${JSON.stringify(id)}`,
      label: `Company: ${companyLabel(id, companies)}`,
      clear: { companyIds: filters.companyIds.filter((value) => value !== id) },
    })),
    ...filters.marketplaces.map((marketplace) => ({
      key: `marketplace:${marketplace}`,
      label: `Marketplace: ${marketplace}`,
      clear: { marketplaces: filters.marketplaces.filter((value) => value !== marketplace) },
    })),
    ...filters.statuses.map((status) => ({
      key: `status:${status}`,
      label: `Status: ${FEE_STATUS_LABELS[status]}`,
      clear: { statuses: filters.statuses.filter((value) => value !== status) },
    })),
  ];
  if (!chips.length) return null;
  return (
    <Group gap="xs" mb="sm" role="group" aria-label="Applied fee filters">
      <Text size="xs" c="dimmed">
        Applied filters
      </Text>
      {chips.map(({ key, label, clear }) => (
        <Button
          key={key}
          className="fee-filter-chip"
          variant="light"
          size="compact-xs"
          aria-label={`Remove ${label}`}
          rightSection={<span aria-hidden="true">×</span>}
          onClick={(event) => {
            if (event.detail === 0) focusTarget.current?.focus();
            onChange(clear);
          }}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
