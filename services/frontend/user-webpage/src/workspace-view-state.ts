import type { Dispatch, SetStateAction } from "react";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { DATASET_CONFIG } from "./api/config.ts";
import type { DatasetKey } from "./api/types.ts";
import { PAGE_SIZES } from "./view-model";

export interface DatasetViewState {
  search: string;
  pagination: PaginationState;
  sorting: SortingState;
}

export interface FeeViewState {
  search: string;
  pageIndex: number;
  pageSize: number;
  expanded: string[];
}

export interface ViewStateProps<State> {
  viewState: State;
  onViewStateChange: Dispatch<SetStateAction<State>>;
}

export function createDatasetViewState(dataset: DatasetKey): DatasetViewState {
  const sort = DATASET_CONFIG[dataset].defaultSort;
  return {
    search: "",
    pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] },
    sorting: [{ id: sort.column, desc: sort.direction === "desc" }],
  };
}

export function createFeeViewState(): FeeViewState {
  return { search: "", pageIndex: 0, pageSize: PAGE_SIZES[0], expanded: [] };
}
