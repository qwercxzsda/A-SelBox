import { isFeeRate } from "./api/sku-configuration-codec.ts";
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
} from "./api/sku-configuration-types.ts";

export interface SkuFormIssue {
  sku: string;
  message: string;
  periodIndex?: number;
  field?: keyof SkuConfigurationPeriod | "company_id" | "sku";
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
    return (
      draft.company_id !== snapshot.company_id ||
      draft.expected_current_version_id !== snapshot.expected_current_version_id ||
      draft.periods.length !== snapshot.periods.length ||
      draft.periods.some((period, index) => {
        const original = snapshot.periods[index];
        return (
          period.marketplace_name !== original.marketplace_name ||
          period.valid_from !== original.valid_from ||
          period.valid_to !== original.valid_to ||
          period.fee_rate_percent !== original.fee_rate_percent
        );
      })
    );
  });
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

export function validateSkuItem(item: SkuConfigurationItem): SkuFormIssue[] {
  const issues: SkuFormIssue[] = [];
  const add = (message: string, field?: SkuFormIssue["field"], periodIndex?: number) =>
    issues.push({ sku: item.sku, message, field, periodIndex });
  if (!item.sku.trim() || item.sku.includes("\0")) add("Enter a SKU.", "sku");
  if (!item.company_id) add("Choose a company.", "company_id");
  item.periods.forEach((period, index) => {
    if (!isMarketplace(period.marketplace_name))
      add("Choose a marketplace.", "marketplace_name", index);
    if (!isFeeRate(period.fee_rate_percent))
      add("Enter a fee from 0 to 100 with up to 6 decimal places.", "fee_rate_percent", index);
    if (!isCalendarDate(period.valid_from)) add("Choose a valid start date.", "valid_from", index);
    if (
      period.valid_to !== null &&
      (!isCalendarDate(period.valid_to) || period.valid_to <= period.valid_from)
    )
      add("The end date must be after the start date, or left blank.", "valid_to", index);
  });
  const periods = indexFeePeriods(item.periods);
  for (const index of overlappingFeePeriods(periods))
    add("These dates overlap another fee period for this marketplace.", "valid_from", index);
  for (const gap of feeCoverageGaps(item.requirements, periods)) {
    add(
      `${gap.marketplace_name} needs a fee rate from ${gap.valid_from} to before ${gap.valid_to}.`,
    );
  }
  return issues;
}

export function resolveSkuConfiguration(
  items: readonly SkuConfigurationItem[],
  drafts: readonly SkuConfigurationChange[],
) {
  const effectiveItems = applySkuDrafts(items, drafts);
  const issues = effectiveItems.flatMap(validateSkuItem);
  const savedBySku = new Map(items.map((item) => [item.sku, item]));
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
  return { items: effectiveItems, issues, issuesBySku };
}
