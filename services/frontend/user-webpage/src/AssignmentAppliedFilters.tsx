import type { RefObject } from "react";
import { AppliedFilterChips } from "./AppliedFilterChips";
import {
  ASSIGNMENT_KIND_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  CLEARED_ASSIGNMENT_FILTERS,
  type AssignmentFilters,
} from "./assignments-view";
import { selectionChips } from "./selection-filters";
import { companyLabel } from "./view-model";

/** One chip per column-filter value; the search term stays in the search box. */
export function AssignmentAppliedFilters({
  filters: { kinds, companyIds, marketplaces, statuses },
  companies,
  onChange,
  focusTarget,
}: {
  filters: AssignmentFilters;
  companies: Map<string, string>;
  onChange: (patch: Partial<AssignmentFilters>) => void;
  focusTarget: RefObject<HTMLElement | null>;
}) {
  return (
    <AppliedFilterChips
      label="Applied assignment filters"
      focusTarget={focusTarget}
      onChange={onChange}
      onClearAll={() => {
        onChange(CLEARED_ASSIGNMENT_FILTERS);
      }}
      chips={[
        ...selectionChips(
          "Source",
          kinds,
          (kind) => ASSIGNMENT_KIND_LABELS[kind],
          (kinds) => ({ kinds }),
        ),
        ...selectionChips(
          "Company",
          companyIds,
          (id) => companyLabel(id, companies),
          (companyIds) => ({ companyIds }),
        ),
        ...selectionChips("Marketplace", marketplaces, String, (marketplaces) => ({
          marketplaces,
        })),
        ...selectionChips(
          "Status",
          statuses,
          (status) => ASSIGNMENT_STATUS_LABELS[status],
          (statuses) => ({ statuses }),
        ),
      ]}
    />
  );
}
