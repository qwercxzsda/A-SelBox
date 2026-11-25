import {
  ASSIGNMENT_KINDS,
  assignmentKey,
  type Assignment,
  type AssignmentKind,
  type AssignmentWarning,
} from "./api/assignment-types.ts";
import { isMarketplace } from "./api/marketplaces.ts";
import { isJsonObject, isUuid } from "./api/validation.ts";
import { matchesSelection, searchLocalList } from "./local-list.ts";
import type { StatusTone } from "./StatusBadge";
import { PAGE_SIZES } from "./view-model.ts";
import { savedPageIndex, savedPageSize, savedText } from "./saved-values.ts";
import { nullableValues, writeListPosition } from "./workspace-list-location.ts";

export const ASSIGNMENT_STATUSES = ["needs-setup", "products-disagree", "saved"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  "needs-setup": "Needs setup",
  "products-disagree": "Products disagree",
  saved: "Saved",
};

export const ASSIGNMENT_STATUS_TONES: Record<AssignmentStatus, StatusTone> = {
  "needs-setup": "warning",
  "products-disagree": "warning",
  saved: "success",
};

export const ASSIGNMENT_KIND_LABELS: Record<AssignmentKind, string> = {
  CAMPAIGN: "Campaign",
  PROMOTION: "Promotion",
  SHIPMENT: "Shipment",
};

const WARNING_STATUSES: Record<AssignmentWarning, AssignmentStatus> = {
  NO_ASSIGNMENT: "needs-setup",
  PRODUCTS_DISAGREE: "products-disagree",
};

/** An unsaved company choice; it survives switching to Companies to add a company. */
export interface AssignmentEditorDraft {
  key: string;
  companyId: string | null;
  memo: string;
  /** The saved version editing started from (null: never assigned); the save expects it. */
  expectedVersionId: string | null;
}

export interface AssignmentFilters {
  kinds: AssignmentKind[];
  companyIds: (string | null)[];
  marketplaces: string[];
  statuses: AssignmentStatus[];
}

export interface AssignmentListState extends AssignmentFilters {
  search: string;
  pageSize: number;
  pageIndex: number;
  selected: string | null;
  editor: AssignmentEditorDraft | null;
}

/** Every column filter removed; the search term is kept. */
export const CLEARED_ASSIGNMENT_FILTERS: AssignmentFilters = {
  kinds: [],
  companyIds: [],
  marketplaces: [],
  statuses: [],
};

function known<T>(values: readonly T[], saved: unknown): T[] {
  return Array.isArray(saved) ? values.filter((value) => saved.includes(value)) : [];
}

/** A draft without the version it started from cannot be saved safely, so it is dropped. */
function decodeEditor(value: unknown, selected: string | null): AssignmentEditorDraft | null {
  if (!isJsonObject(value) || value.key !== selected || selected === null) return null;
  const expectedVersionId = value.expectedVersionId;
  if (expectedVersionId !== null && !isUuid(expectedVersionId)) return null;
  return {
    key: selected,
    companyId: isUuid(value.companyId) ? value.companyId : null,
    memo: savedText(value.memo),
    expectedVersionId,
  };
}

function companyIds(saved: unknown): (string | null)[] {
  if (!Array.isArray(saved)) return [];
  return [
    ...new Set(saved.filter((id: unknown): id is string | null => id === null || isUuid(id))),
  ];
}

export function decodeAssignmentList(value: unknown): AssignmentListState {
  const saved = isJsonObject(value) ? value : {};
  const selected = savedText(saved.selected) || null;
  return {
    search: savedText(saved.search),
    kinds: known(ASSIGNMENT_KINDS, saved.kinds),
    companyIds: companyIds(saved.companyIds),
    marketplaces: Array.isArray(saved.marketplaces)
      ? [...new Set<string>(saved.marketplaces.filter(isMarketplace))]
      : [],
    statuses: known(ASSIGNMENT_STATUSES, saved.statuses),
    pageSize: savedPageSize(saved.pageSize),
    pageIndex: savedPageIndex(saved.pageIndex),
    selected,
    editor: decodeEditor(saved.editor, selected),
  };
}

/** Members see neither companies nor review statuses, so those filters never apply to them. */
export function memberAssignmentList(state: AssignmentListState): AssignmentListState {
  return { ...state, companyIds: [], statuses: [] };
}

export function assignmentStatus(row: Assignment): AssignmentStatus {
  return row.warning ? WARNING_STATUSES[row.warning] : "saved";
}

/** How the saved assignment was made; null before the first assignment. */
export function assignmentOriginText(row: Assignment): string | null {
  if (row.origin === null) return null;
  if (row.companyId === null) return "Cleared by an administrator";
  return row.origin === "AUTOMATIC" ? "Assigned automatically" : "Assigned by an administrator";
}

/** One name, "N marketplaces", or null when the ID's marketplace is unknown. */
export function marketplaceSummary(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${String(names.length)} marketplaces`;
}

/** The drawer context leads with the ID: "ship-300 · Shipment · Amazon.co.jp". */
export function assignmentContext(row: Assignment): string {
  return [row.nativeKey, ASSIGNMENT_KIND_LABELS[row.kind], marketplaceSummary(row.marketplaceNames)]
    .filter(Boolean)
    .join(" · ");
}

/** Search by reference ID (and company for administrators), then apply the column filters. */
export function filterAssignments(
  items: readonly Assignment[],
  state: AssignmentListState,
  companies: Map<string, string> | null,
): Assignment[] {
  return searchLocalList(
    items,
    state.search,
    (row) => row.nativeKey,
    companies ? { id: (row) => row.companyId, names: companies } : undefined,
  ).filter(
    (row) =>
      matchesSelection(state.kinds, [row.kind]) &&
      matchesSelection(state.companyIds, [row.companyId]) &&
      matchesSelection(state.marketplaces, row.marketplaceNames) &&
      matchesSelection(state.statuses, [assignmentStatus(row)]),
  );
}

/** A fresh editor starts from the saved company, or the suggestion for an ID without one. */
export function newEditorDraft(row: Assignment): AssignmentEditorDraft {
  return {
    key: assignmentKey(row),
    companyId: row.companyId ?? row.suggestedCompanyId,
    memo: "",
    expectedVersionId: row.versionId,
  };
}

/** The first ID without a company, in list order. */
export function nextUnassigned(items: readonly Assignment[]): Assignment | null {
  return searchLocalList(items, "", (row) => row.nativeKey).find((row) => !row.companyId) ?? null;
}

/** Read-only list state for a shareable URL; the unsaved editor never enters it. */
export function readAssignmentLocation(params: URLSearchParams, saved: unknown) {
  return decodeAssignmentList({
    search: params.get("search"),
    kinds: params.getAll("source"),
    companyIds: nullableValues(params, "company"),
    marketplaces: params.getAll("marketplace"),
    statuses: params.getAll("status"),
    pageIndex: Number(params.get("page") ?? 0),
    pageSize: Number(params.get("size") ?? PAGE_SIZES[0]),
    selected: params.get("row"),
    editor: isJsonObject(saved) ? saved.editor : null,
  });
}

export function writeAssignmentLocation(params: URLSearchParams, state: AssignmentListState) {
  writeListPosition(params, { ...state, selectedRowId: state.selected });
  for (const kind of state.kinds) params.append("source", kind);
  for (const id of state.companyIds) params.append("company", JSON.stringify(id));
  for (const marketplace of state.marketplaces) params.append("marketplace", marketplace);
  for (const status of state.statuses) params.append("status", status);
}
