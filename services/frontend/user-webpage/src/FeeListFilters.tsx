import type { RefObject } from "react";
import { ColumnMenu } from "./ColumnMenu";
import { FEE_STATUS_LABELS, type FeeStatus } from "./fee-status";
import type { FeeViewState } from "./workspace-view-state";
import { companyLabel } from "./view-model";
import { filterOptions } from "./filter-options";
import { CLEARED_FEE_FILTERS } from "./fee-filters";
import { AppliedFilterChips } from "./AppliedFilterChips";
import {
  codeMenu,
  companyMenu,
  marketplaceMenu,
  selectionChips,
  type SelectionMenu,
} from "./selection-filters";

type FeeFilters = Pick<FeeViewState, "skus" | "companyIds" | "marketplaces" | "statuses">;
interface FeeFilterProps {
  filters: FeeFilters;
  companies: Map<string, string>;
  onChange: (patch: Partial<FeeFilters>) => void;
}

const LABELS: Record<keyof FeeFilters, string> = {
  skus: "SKU",
  companyIds: "Company",
  marketplaces: "Marketplace",
  statuses: "Status",
};

export function FeeFilterHeader({
  field,
  filters,
  companies,
  skus,
  statusOptions,
  onChange,
}: FeeFilterProps & {
  field: keyof FeeFilters;
  skus: string[];
  statusOptions: readonly FeeStatus[];
}) {
  const menus: Record<keyof FeeFilters, () => SelectionMenu> = {
    // SKUs are data, so their options come from the loaded list.
    skus: () => ({
      value: filters.skus,
      options: filterOptions("sku", skus, filters.skus),
      onChange: (skus) => {
        onChange({ skus });
      },
    }),
    companyIds: () =>
      companyMenu(filters.companyIds, companies, (companyIds) => {
        onChange({ companyIds });
      }),
    marketplaces: () =>
      marketplaceMenu(filters.marketplaces, (marketplaces) => {
        onChange({ marketplaces });
      }),
    statuses: () =>
      codeMenu(statusOptions, FEE_STATUS_LABELS, filters.statuses, (statuses) => {
        onChange({ statuses });
      }),
  };
  return <ColumnMenu label={LABELS[field]} filter={{ kind: "selection", ...menus[field]() }} />;
}

export function AppliedFeeFilters({
  filters,
  companies,
  onChange,
  focusTarget,
}: FeeFilterProps & { focusTarget: RefObject<HTMLInputElement | null> }) {
  const chips = [
    ...selectionChips(LABELS.skus, filters.skus, String, (skus) => ({ skus })),
    ...selectionChips(
      LABELS.companyIds,
      filters.companyIds,
      (id) => companyLabel(id, companies),
      (companyIds) => ({ companyIds }),
    ),
    ...selectionChips(LABELS.marketplaces, filters.marketplaces, String, (marketplaces) => ({
      marketplaces,
    })),
    ...selectionChips(
      LABELS.statuses,
      filters.statuses,
      (status) => FEE_STATUS_LABELS[status],
      (statuses) => ({ statuses }),
    ),
  ];
  return (
    <AppliedFilterChips
      label="Applied fee filters"
      chips={chips}
      onChange={onChange}
      onClearAll={() => {
        onChange(CLEARED_FEE_FILTERS);
      }}
      focusTarget={focusTarget}
    />
  );
}
