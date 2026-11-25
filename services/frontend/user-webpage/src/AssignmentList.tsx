import { useRef, type RefObject } from "react";
import type { Assignment } from "./api/assignment-types";
import { AssignmentAppliedFilters } from "./AssignmentAppliedFilters";
import { AssignmentTable } from "./AssignmentTable";
import {
  CLEARED_ASSIGNMENT_FILTERS,
  filterAssignments,
  type AssignmentListState,
} from "./assignments-view";
import { EmptyState } from "./EmptyState";
import { ListPageNavigation } from "./ListPageNavigation";
import { ListToolbar } from "./ListToolbar";
import { paginateLocalList } from "./local-list";
import { showsBottomPager } from "./pagination";
import { revealSection } from "./reveal-section";

function emptyTitle(filtered: boolean, administrator: boolean) {
  if (filtered) return "No matching assignments";
  return administrator ? "No campaigns, promotions or shipments yet" : "No assignments yet";
}

/** The complete list is loaded once; search, filters and paging run here with exact totals. */
export function AssignmentList({
  items,
  loaded,
  state,
  administrator,
  companies,
  controlsRef,
  onChange,
  onSelect,
}: {
  items: readonly Assignment[];
  loaded: boolean;
  state: AssignmentListState;
  administrator: boolean;
  companies: Map<string, string>;
  controlsRef: RefObject<HTMLDivElement | null>;
  onChange: (patch: Partial<AssignmentListState>) => void;
  onSelect: (key: string) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const page = paginateLocalList(
    filterAssignments(items, state, administrator ? companies : null),
    state.pageIndex,
    state.pageSize,
  );
  // Nothing is counted until the list loads, so the pager claims no page count yet.
  const pageCount = loaded ? page.pageCount : null;
  const canPrevious = loaded && page.pageIndex > 0;
  const canNext = loaded && page.pageIndex < page.pageCount - 1;
  const filtered = Boolean(
    state.search.trim() ||
    state.kinds.length ||
    state.companyIds.length ||
    state.marketplaces.length ||
    state.statuses.length,
  );
  function changeFilters(patch: Partial<AssignmentListState>) {
    onChange({ ...patch, pageIndex: 0 });
  }
  function changePage(pageIndex: number) {
    onChange({ pageIndex });
  }
  return (
    <>
      <ListToolbar
        label="Assignment controls"
        controlsRef={controlsRef}
        search={{
          inputRef: searchInput,
          ariaLabel: "Search assignments",
          placeholder: administrator ? "Reference ID or company" : "Reference ID",
          value: state.search,
          onChange: (search) => {
            changeFilters({ search });
          },
        }}
        pageSize={state.pageSize}
        onPageSizeChange={(pageSize) => {
          changeFilters({ pageSize });
        }}
        pagination={{
          pageIndex: page.pageIndex,
          pageCount,
          canPrevious,
          canNext,
          ariaLabel: "Assignments pagination",
          onPrevious: () => {
            changePage(page.pageIndex - 1);
          },
          onNext: () => {
            changePage(page.pageIndex + 1);
          },
          onPageChange: changePage,
        }}
        rowCount={page.visibleItems.length}
        totalCount={page.totalCount}
        items="assignments"
        message={loaded ? undefined : ""}
      />
      <AssignmentTable
        rows={page.visibleItems}
        state={state}
        administrator={administrator}
        companies={companies}
        onFiltersChange={changeFilters}
        onSelect={onSelect}
        appliedFilters={
          <AssignmentAppliedFilters
            filters={state}
            companies={companies}
            onChange={changeFilters}
            focusTarget={searchInput}
          />
        }
        emptyState={
          loaded && page.visibleItems.length === 0 ? (
            <EmptyState
              title={emptyTitle(filtered, administrator)}
              action={
                filtered
                  ? {
                      label: "Reset search and filters",
                      focusTarget: searchInput,
                      onClick: () => {
                        changeFilters({ search: "", ...CLEARED_ASSIGNMENT_FILTERS });
                      },
                    }
                  : undefined
              }
            />
          ) : undefined
        }
      />
      {showsBottomPager(page.visibleItems.length, page.pageIndex) ? (
        <ListPageNavigation
          labels={{
            navigation: "Assignment navigation at bottom",
            items: "assignments",
            back: "Back to assignment controls",
          }}
          pageIndex={page.pageIndex}
          pageCount={pageCount}
          canPrevious={canPrevious}
          canNext={canNext}
          onBackToFilters={() => {
            revealSection(controlsRef.current);
          }}
          onPageChange={(pageIndex) => {
            changePage(pageIndex);
            revealSection(controlsRef.current);
          }}
        />
      ) : null}
    </>
  );
}
