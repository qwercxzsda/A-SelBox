import type { Dispatch, SetStateAction } from "react";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { DATASET_CONFIG } from "./api/config.ts";
import type { DatasetFilters, DatasetSort, TableDatasetKey } from "./api/types.ts";
import { PAGE_SIZES } from "./view-model.ts";
import { normalizeDatasetFilters } from "./dataset-filters.ts";
import type { SkuConfigurationChange } from "./api/sku-configuration-types.ts";
import type { InventoryPageOptions } from "./inventory-view.ts";
import type { FeeStatus } from "./fee-status.ts";
import type { FeeRateChangeDraft } from "./sku-rate-change.ts";

export type InventoryViewState = InventoryPageOptions & { selectedRowId: string | null };

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
  rateChange: FeeRateChangeDraft | null;
}

export interface FeeViewState {
  search: string;
  skus: string[];
  pageIndex: number;
  pageSize: number;
  selectedSku: string | null;
  expandedSkus: string[];
  drafts: SkuConfigurationChange[];
  changeReason: string;
  companyIds: (string | null)[];
  marketplaces: string[];
  statuses: FeeStatus[];
  saveProblem: string | null;
  requiresReload: boolean;
  savedNotice: string | null;
  refreshFailed: boolean;
  editing: FeeEditorState | null;
  editorDrafts: FeeEditorState[];
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
    marketplaces: [],
    companyIds: [],
    sortColumn: "sku",
    sortDirection: "asc",
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
    selectedRowId: null,
  };
}

export function createDatasetViewState(dataset: TableDatasetKey): DatasetViewState {
  const sort: DatasetSort = DATASET_CONFIG[dataset].defaultSort;
  return {
    search: "",
    pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] },
    sorting: [{ id: sort.column, desc: sort.direction === "desc" }],
    filters: normalizeDatasetFilters(),
    selectedRowId: null,
  };
}

export function createFeeViewState(): FeeViewState {
  return {
    search: "",
    skus: [],
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
    selectedSku: null,
    expandedSkus: [],
    drafts: [],
    changeReason: "",
    companyIds: [],
    marketplaces: [],
    statuses: [],
    saveProblem: null,
    requiresReload: false,
    savedNotice: null,
    refreshFailed: false,
    editing: null,
    editorDrafts: [],
    reviewing: false,
    savePending: false,
  };
}
