import type { SkuConfigurationItem } from "./api/sku-configuration-types.ts";
import { FEE_STATUSES, type FeeStatus } from "./fee-status.ts";
import { matchesSelection, searchLocalList } from "./local-list.ts";
import type { SkuFormIssue } from "./sku-configuration-form.ts";
import type { FeeViewState } from "./workspace-view-state.ts";

/** Every column filter removed; the search term is kept. */
export const CLEARED_FEE_FILTERS = {
  skus: [],
  companyIds: [],
  marketplaces: [],
  statuses: [],
} satisfies Partial<FeeViewState>;

/** Marketplaces with a fee period or a missing fee rate, sorted. */
export function feeMarketplaces(item: SkuConfigurationItem): string[] {
  return [
    ...new Set(
      [
        ...item.periods.map((period) => period.marketplace_name),
        ...item.requirements.map((requirement) => requirement.marketplace_name),
      ].filter(Boolean),
    ),
  ].sort();
}

/**
 * The fee list after search and column filters. Members see neither companies nor drafts, so
 * those filters and statuses never apply to them.
 */
export function filterFeeList(
  items: readonly SkuConfigurationItem[],
  viewState: FeeViewState,
  {
    administrator,
    companies,
    issuesBySku,
  }: {
    administrator: boolean;
    companies: Map<string, string>;
    issuesBySku: Map<string, SkuFormIssue[]>;
  },
) {
  const draftSkus = new Set(viewState.drafts.map((draft) => draft.sku));
  const unfinishedSkus = new Set(
    viewState.editorDrafts.filter((editor) => !editor.isNew).map((editor) => editor.sku),
  );
  const statusOptions: readonly FeeStatus[] = administrator
    ? FEE_STATUSES
    : ["needs-setup", "saved"];
  const filters = {
    skus: viewState.skus,
    companyIds: administrator ? viewState.companyIds : [],
    marketplaces: viewState.marketplaces,
    statuses: viewState.statuses.filter((status) => statusOptions.includes(status)),
  };
  const statusesFor = (sku: string): FeeStatus[] => {
    const statuses: FeeStatus[] = [];
    if (issuesBySku.has(sku)) statuses.push("needs-setup");
    if (administrator && draftSkus.has(sku)) statuses.push("draft");
    if (administrator && unfinishedSkus.has(sku)) statuses.push("unfinished");
    return statuses.length ? statuses : ["saved"];
  };
  const filtered = searchLocalList(
    items,
    viewState.search,
    (item) => item.sku,
    administrator ? { id: (item) => item.company_id, names: companies } : undefined,
  ).filter(
    (item) =>
      matchesSelection(filters.skus, [item.sku]) &&
      matchesSelection(filters.companyIds, [item.company_id]) &&
      matchesSelection(filters.marketplaces, feeMarketplaces(item)) &&
      matchesSelection(filters.statuses, statusesFor(item.sku)),
  );
  const hasFilters = Boolean(
    viewState.search || Object.values(filters).some(({ length }) => length),
  );
  return { filtered, filters, statusOptions, statusesFor, hasFilters };
}
