import type { RefObject } from "react";
import { ColumnMenu } from "./ColumnMenu";
import { FEE_STATUS_LABELS, type FeeStatus } from "./fee-status";
import type { FeeViewState } from "./workspace-view-state";
import { companyLabel } from "./view-model";
import { filterOptions } from "./filter-options";
import { AppliedFilterChips } from "./AppliedFilterChips";
import type { ColumnMenuFilter } from "./ColumnFilters";

type FeeFilters = Pick<FeeViewState, "skus" | "companyIds" | "marketplaces" | "statuses">;
interface FeeFilterProps {
  filters: FeeFilters;
  companies: Map<string, string>;
  onChange: (patch: Partial<FeeFilters>) => void;
}

export function FeeFilterHeader({
  field,
  filters,
  companies,
  skus,
  marketplaces,
  statusOptions,
  onChange,
}: FeeFilterProps & {
  field: keyof FeeFilters;
  skus: string[];
  marketplaces: string[];
  statusOptions: readonly FeeStatus[];
}) {
  type Selection = Omit<Extract<ColumnMenuFilter, { kind: "selection" }>, "kind"> & {
    label: string;
  };
  const configure: Record<keyof FeeFilters, () => Selection> = {
    skus: () => ({
      label: "SKU",
      value: filters.skus,
      options: filterOptions("sku", skus, filters.skus),
      onChange: (skus) => {
        onChange({ skus });
      },
    }),
    companyIds: () => ({
      label: "Company",
      value: filters.companyIds.map((id) => JSON.stringify(id)),
      options: [...new Set([...companies.keys(), ...filters.companyIds, null])]
        .map((id) => ({ value: JSON.stringify(id), label: companyLabel(id, companies) }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      onChange: (values) => {
        onChange({ companyIds: values.map((value) => JSON.parse(value) as string | null) });
      },
    }),
    marketplaces: () => ({
      label: "Marketplace",
      value: filters.marketplaces,
      options: [...new Set([...marketplaces, ...filters.marketplaces])]
        .sort()
        .map((value) => ({ value, label: value })),
      onChange: (marketplaces) => {
        onChange({ marketplaces });
      },
    }),
    statuses: () => ({
      label: "Status",
      value: filters.statuses,
      options: statusOptions.map((value) => ({ value, label: FEE_STATUS_LABELS[value] })),
      onChange: (values) => {
        onChange({ statuses: statusOptions.filter((status) => values.includes(status)) });
      },
    }),
  };
  const { label, ...selection } = configure[field]();
  return <ColumnMenu label={label} filter={{ kind: "selection", ...selection }} />;
}

export function AppliedFeeFilters({
  filters,
  companies,
  onChange,
  focusTarget,
}: FeeFilterProps & { focusTarget: RefObject<HTMLInputElement | null> }) {
  const chips = [
    ...filters.skus.map((sku) => ({
      key: `sku:${sku}`,
      label: `SKU: ${sku}`,
      clear: { skus: filters.skus.filter((value) => value !== sku) },
    })),
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
  return (
    <AppliedFilterChips
      label="Applied fee filters"
      chips={chips}
      onChange={onChange}
      focusTarget={focusTarget}
    />
  );
}
