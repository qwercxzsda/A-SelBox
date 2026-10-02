import transactionTypes from "./generated/transaction-types.json" with { type: "json" };
import type { FilterOption } from "./filter-options.ts";
import { transactionTypeBreakdownGroupId } from "./type-breakdown-groups.ts";

export interface TransactionTypeGroup {
  id: string;
  label: string;
  options: FilterOption[];
}

const GROUPS = {
  sales: "Sales & refunds",
  selling: "Selling fees",
  fulfillment: "Fulfillment & shipping",
  inventory: "Storage & inventory",
  advertising: "Advertising & promotions",
  taxes: "Taxes",
  other: "Other fees & adjustments",
  "seller-costs": "Seller-provided costs",
  reconciliation: "Reconciliation",
} as const;

type GroupId = keyof typeof GROUPS;
type BreakdownGroupId = ReturnType<typeof transactionTypeBreakdownGroupId>;

// Browsing groups reuse the amount breakdown's classification. Selecting a group
// still sends its individual exact type keys; it changes no accounting rules.
const FILTER_GROUPS: Record<BreakdownGroupId, GroupId> = {
  "sales-and-refunds": "sales",
  "sponsored-products": "advertising",
  "fba-fulfillment": "fulfillment",
  referral: "selling",
  "inbound-placement": "fulfillment",
  "inbound-transportation": "fulfillment",
  disposal: "inventory",
  "refund-administration": "selling",
  "monthly-storage": "inventory",
  "sponsored-brands": "advertising",
  "sponsored-display": "advertising",
  advertising: "advertising",
  "digital-services": "selling",
  removal: "inventory",
  "long-term-storage": "inventory",
  labeling: "fulfillment",
  "shipping-gift-wrap": "fulfillment",
  promotions: "advertising",
  taxes: "taxes",
  reimbursements: "inventory",
  liquidations: "inventory",
  "off-amazon-costs": "seller-costs",
  reconciliation: "reconciliation",
  other: "other",
};

const KNOWN_TYPES = new Set([
  ...transactionTypes.map(({ type }) => type),
  "SETTLEMENT_KIOSK_DIFFERENCE",
]);

export function transactionTypeGroups(options: readonly FilterOption[]): TransactionTypeGroup[] {
  const groups = new Map<GroupId, FilterOption[]>();
  for (const option of options) {
    const id = KNOWN_TYPES.has(option.value)
      ? FILTER_GROUPS[transactionTypeBreakdownGroupId(option.value)]
      : "other";
    const entries = groups.get(id) ?? [];
    entries.push(option);
    groups.set(id, entries);
  }
  return Object.entries(GROUPS).flatMap(([id, label]) => {
    const entries = groups.get(id as GroupId);
    return entries
      ? [
          {
            id,
            label,
            options: entries.sort(
              (left, right) =>
                left.label.localeCompare(right.label, "en") ||
                left.value.localeCompare(right.value, "en"),
            ),
          },
        ]
      : [];
  });
}

/** Collapse complete groups in applied-filter chips; keep partial selections explicit. */
export function transactionTypeSelectionLabels(
  options: readonly FilterOption[],
  selected: readonly string[],
): string[] {
  const remaining = new Set(selected);
  const labels: string[] = [];
  for (const group of transactionTypeGroups(options)) {
    // An unfamiliar saved selection must remain visible even when every known
    // entry in Other is selected. It has no established browsing classification.
    const known = group.options.filter(({ value }) => KNOWN_TYPES.has(value));
    const chosen = known.filter(({ value }) => remaining.has(value));
    if (!chosen.length) continue;
    labels.push(
      ...(chosen.length === known.length ? [group.label] : chosen.map(({ label }) => label)),
    );
    chosen.forEach(({ value }) => remaining.delete(value));
  }
  const optionLabels = new Map(options.map(({ value, label }) => [value, label]));
  return [...labels, ...[...remaining].map((value) => optionLabels.get(value) ?? value)];
}
