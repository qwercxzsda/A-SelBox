import type { Dispatch, SetStateAction } from "react";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { DATASET_CONFIG } from "./api/config.ts";
import type { DatasetFilters, TableDatasetKey } from "./api/types.ts";
import { PAGE_SIZES } from "./view-model.ts";
import { normalizeDatasetFilters } from "./dataset-filters.ts";
import type { SkuConfigurationChange } from "./api/sku-configuration-types.ts";
import type { FetchInventoryPageOptions } from "./api/inventory.ts";

export type InventoryViewState = Omit<
  FetchInventoryPageOptions,
  "accessToken" | "signal" | "searchValues"
> & { selectedRowId: string | null };

export interface DatasetViewState {
  search: string;
  pagination: PaginationState;
  sorting: SortingState;
  filters: DatasetFilters;
  selectedRowId: string | null;
}

export interface FeeEditorState {
  sku: string;
  isNew: boolean;
  form: SkuConfigurationChange;
  submitError: string | null;
}

export interface FeeViewState {
  search: string;
  pageIndex: number;
  pageSize: number;
  expanded: string[];
  drafts: SkuConfigurationChange[];
  changeReason: string;
  onlyIncomplete: boolean;
  saveProblem: string | null;
  requiresReload: boolean;
  savedNotice: string | null;
  refreshFailed: boolean;
  editing: FeeEditorState | null;
  reviewing: boolean;
  savePending: boolean;
}

export interface ViewStateProps<State> {
  viewState: State;
  onViewStateChange: Dispatch<SetStateAction<State>>;
}

export function createInventoryViewState(): InventoryViewState {
  return {
    search: "",
    skus: [],
    healthStatuses: [],
    recommendations: [],
    marketplace: "",
    sortColumn: "sku",
    sortDirection: "asc",
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
    selectedRowId: null,
  };
}

export function createDatasetViewState(dataset: TableDatasetKey): DatasetViewState {
  const sort = DATASET_CONFIG[dataset].defaultSort;
  return {
    search: "",
    pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] },
    sorting: [{ id: sort.column, desc: true }],
    filters: normalizeDatasetFilters(),
    selectedRowId: null,
  };
}

export function createFeeViewState(): FeeViewState {
  return {
    search: "",
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
    expanded: [],
    drafts: [],
    changeReason: "",
    onlyIncomplete: false,
    saveProblem: null,
    requiresReload: false,
    savedNotice: null,
    refreshFailed: false,
    editing: null,
    reviewing: false,
    savePending: false,
  };
}
