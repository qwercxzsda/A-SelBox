import { isFeeRate } from "./api/sku-configuration-codec.ts";
import { FEE_DATE_ERROR, FEE_PERIOD_ORDER_ERROR } from "./fee-period-labels.ts";
import {
  feeCoverageGaps,
  indexFeePeriods,
  isCalendarDate,
  isMarketplace,
  overlappingFeePeriods,
} from "./sku-fee-coverage.ts";
import type {
  SkuConfigurationChange,
  SkuConfigurationItem,
  SkuConfigurationPeriod,
  SkuConfigurationRequirement,
} from "./api/sku-configuration-types.ts";

/** The fee rate rule, shared by period fields and Change rate from date. */
export const FEE_RATE_ERROR = "Enter 0–100, up to 6 decimals.";

export interface SkuFormIssue {
  sku: string;
  message: string;
  periodIndex?: number;
  field?: keyof SkuConfigurationPeriod | "company_id" | "sku";
  /** A required date range without a fee rate, shown as one table row. */
  gap?: SkuConfigurationRequirement;
}

export function newSkuItem(sku = ""): SkuConfigurationItem {
  return {
    sku,
    sku_id: null,
    company_id: null,
    terms_version_id: null,
    periods: [],
    requirements: [],
    issues: [],
  };
}

/** Missing required intervals start with an empty rate; zero is never invented. */
export function createSkuDraft(item: SkuConfigurationItem): SkuConfigurationChange {
  const gaps = feeCoverageGaps(item.requirements, indexFeePeriods(item.periods));
  const existingMarkets = new Set(item.periods.map((period) => period.marketplace_name));
  const newMarkets = new Map<string, SkuConfigurationPeriod>();
  for (const gap of gaps) {
    if (existingMarkets.has(gap.marketplace_name)) continue;
    const previous = newMarkets.get(gap.marketplace_name);
    if (!previous || gap.valid_from < previous.valid_from)
      newMarkets.set(gap.marketplace_name, {
        marketplace_name: gap.marketplace_name,
        valid_from: gap.valid_from,
        valid_to: null,
        fee_rate_percent: "",
      });
  }
  return {
    sku: item.sku,
    company_id: item.company_id,
    expected_current_version_id: item.terms_version_id,
    periods: [
      ...item.periods.map((period) => ({ ...period })),
      ...gaps
        .filter((gap) => existingMarkets.has(gap.marketplace_name))
        .map((gap) => ({ ...gap, fee_rate_percent: "" })),
      ...newMarkets.values(),
    ],
  };
}

/** Completion must never discard a newer draft that was not part of the submitted snapshot. */
export function clearSubmittedDrafts(
  current: SkuConfigurationChange[],
  submitted: SkuConfigurationChange[],
): SkuConfigurationChange[] {
  const snapshots = new Map(submitted.map((draft) => [draft.sku, draft]));
  return current.filter((draft) => {
    const snapshot = snapshots.get(draft.sku);
    if (!snapshot) return true;
    return !sameSkuDraft(draft, snapshot);
  });
}

export function sameSkuDraft(
  draft: SkuConfigurationChange,
  snapshot: SkuConfigurationChange,
): boolean {
  return (
    draft.sku === snapshot.sku &&
    draft.company_id === snapshot.company_id &&
    draft.expected_current_version_id === snapshot.expected_current_version_id &&
    sameFeePeriods(draft.periods, snapshot.periods)
  );
}

export function sameFeePeriods(
  periods: readonly SkuConfigurationPeriod[],
  snapshot: readonly SkuConfigurationPeriod[],
): boolean {
  return (
    periods.length === snapshot.length &&
    periods.every((period, index) => {
      const original = snapshot[index];
      return (
        period.marketplace_name === original.marketplace_name &&
        period.valid_from === original.valid_from &&
        period.valid_to === original.valid_to &&
        period.fee_rate_percent === original.fee_rate_percent
      );
    })
  );
}

function applySkuDrafts(
  items: readonly SkuConfigurationItem[],
  drafts: readonly SkuConfigurationChange[],
): SkuConfigurationItem[] {
  const effective = new Map(items.map((item) => [item.sku, item]));
  for (const draft of drafts) {
    const saved = effective.get(draft.sku) ?? newSkuItem(draft.sku);
    effective.set(draft.sku, { ...saved, company_id: draft.company_id, periods: draft.periods });
  }
  return [...effective.values()].sort((left, right) =>
    left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0,
  );
}

export function validateSkuItem(
  item: SkuConfigurationItem,
  knownCompanyIds?: ReadonlySet<string>,
  clearingCompany = false,
): SkuFormIssue[] {
  const issues: SkuFormIssue[] = [];
  const add = (message: string, field?: SkuFormIssue["field"], periodIndex?: number) =>
    issues.push({ sku: item.sku, message, field, periodIndex });
  if (!item.sku.trim() || item.sku.includes("\0")) add("Enter a SKU.", "sku");
  if (!item.company_id && !clearingCompany) add("Choose a company.", "company_id");
  else if (item.company_id && knownCompanyIds && !knownCompanyIds.has(item.company_id))
    add("This company is no longer available. Choose another company.", "company_id");
  item.periods.forEach((period, index) => {
    if (!isMarketplace(period.marketplace_name))
      add("Choose a marketplace.", "marketplace_name", index);
    if (!isFeeRate(period.fee_rate_percent)) add(FEE_RATE_ERROR, "fee_rate_percent", index);
    if (!isCalendarDate(period.valid_from)) add(FEE_DATE_ERROR, "valid_from", index);
    if (
      period.valid_to !== null &&
      (!isCalendarDate(period.valid_to) || period.valid_to <= period.valid_from)
    )
      add(FEE_PERIOD_ORDER_ERROR, "valid_to", index);
  });
  const periods = indexFeePeriods(item.periods);
  for (const index of overlappingFeePeriods(periods))
    add("These dates overlap another fee period for this marketplace.", "valid_from", index);
  for (const gap of feeCoverageGaps(clearingCompany ? [] : item.requirements, periods))
    issues.push({
      sku: item.sku,
      message: `Missing fee rate: ${gap.marketplace_name}, ${gap.valid_from} to ${gap.valid_to}`,
      gap,
    });
  return issues;
}

/** The form path of a field issue: "company_id" or "periods.2.fee_rate_percent". */
function issuePath({ field, periodIndex }: SkuFormIssue): string | undefined {
  if (!field) return undefined;
  return periodIndex === undefined ? field : `periods.${String(periodIndex)}.${field}`;
}

function fieldValue(values: SkuConfigurationChange, { field, periodIndex }: SkuFormIssue) {
  if (field === "sku") return values.sku;
  if (field === "company_id") return values.company_id;
  return field && periodIndex !== undefined ? values.periods.at(periodIndex)?.[field] : undefined;
}

/**
 * Whether the editor shows an issue at its field. A filled-in value shows its error at once. A blank
 * field waits until the user typed into or left it (`visited` paths, which follow their periods).
 */
export function showsFieldError(
  issue: SkuFormIssue,
  values: SkuConfigurationChange,
  visited: readonly string[],
): boolean {
  const path = issuePath(issue);
  return path === undefined || visited.includes(path) || Boolean(fieldValue(values, issue));
}

const PERIOD_FIELDS = [
  "marketplace_name",
  "fee_rate_percent",
  "valid_from",
  "valid_to",
] as const satisfies readonly (keyof SkuConfigurationPeriod)[];

/** Every field path of a draft. A kept draft reopens with all of its errors shown. */
export function formPaths(draft: SkuConfigurationChange): string[] {
  return [
    "company_id",
    ...draft.periods.flatMap((_, index) =>
      PERIOD_FIELDS.map((field) => `periods.${String(index)}.${field}`),
    ),
  ];
}

/** A field path of a form with `periodCount` periods: "sku", "company_id" or "periods.<n>.<field>". */
export function isFormPath(path: string, periodCount: number): boolean {
  if (path === "sku" || path === "company_id") return true;
  const match = /^periods\.(0|[1-9]\d*)\.(\w+)$/.exec(path);
  return (
    match !== null &&
    Number(match[1]) < periodCount &&
    PERIOD_FIELDS.some((field) => field === match[2])
  );
}

/**
 * Keeps visited period paths on their periods after `count` periods are inserted at `index`, or
 * removed from it when `count` is negative.
 */
export function movePeriodPaths(paths: readonly string[], index: number, count: number): string[] {
  return paths.flatMap((path) => {
    const match = /^periods\.(\d+)\.(\w+)$/.exec(path);
    const period = match ? Number(match[1]) : -1;
    if (!match || period < index) return [path];
    return period >= index - Math.min(count, 0)
      ? [`periods.${String(period + count)}.${match[2]}`]
      : [];
  });
}

export function resolveSkuConfiguration(
  items: readonly SkuConfigurationItem[],
  drafts: readonly SkuConfigurationChange[],
  knownCompanyIds?: ReadonlySet<string>,
) {
  const effectiveItems = applySkuDrafts(items, drafts);
  const savedBySku = new Map(items.map((item) => [item.sku, item]));
  const issues = effectiveItems.flatMap((item) =>
    validateSkuItem(
      item,
      knownCompanyIds,
      !item.company_id && Boolean(savedBySku.get(item.sku)?.company_id),
    ),
  );
  for (const draft of drafts) {
    const saved = savedBySku.get(draft.sku);
    if ((saved?.terms_version_id ?? null) !== draft.expected_current_version_id)
      issues.push({
        sku: draft.sku,
        message: "Saved settings changed. Review the latest settings before saving.",
      });
  }
  const issuesBySku = new Map<string, SkuFormIssue[]>();
  for (const issue of issues) {
    const group = issuesBySku.get(issue.sku) ?? [];
    group.push(issue);
    issuesBySku.set(issue.sku, group);
  }
  const changedSkus = new Set(drafts.map((draft) => draft.sku));
  const draftIssues = issues.filter((issue) => changedSkus.has(issue.sku));
  return { items: effectiveItems, issues, issuesBySku, draftIssues };
}
