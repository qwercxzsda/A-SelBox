import type { FilterOption } from "./filter-options.ts";
import {
  isRegisteredTransactionType,
  transactionTypeGroup,
} from "./transaction-type-family-catalog.ts";

import { TRANSACTION_TYPE_GROUPS, type TypeGroupId } from "./transaction-type-families.ts";

export interface TransactionTypeGroup {
  id: TypeGroupId;
  label: string;
  options: FilterOption[];
}

/** Row sublabels use the same broad group as filters and amount breakdowns. */
export function transactionTypeGroupLabel(value: string): string {
  return transactionTypeGroup(value).label;
}

export function transactionTypeGroups(options: readonly FilterOption[]): TransactionTypeGroup[] {
  const groups = new Map<TypeGroupId, TransactionTypeGroup>();
  for (const option of options) {
    const definition = transactionTypeGroup(option.value);
    const group = groups.get(definition.id) ?? { ...definition, options: [] };
    group.options.push(option);
    groups.set(definition.id, group);
  }
  return TRANSACTION_TYPE_GROUPS.flatMap(({ id }) => {
    const group = groups.get(id);
    if (!group) return [];
    group.options.sort(
      (left, right) =>
        left.label.localeCompare(right.label, "en") || left.value.localeCompare(right.value, "en"),
    );
    return [group];
  });
}

/** Match all words against either a group name or an individual type, never a mix. */
export function searchTransactionTypeGroups(
  groups: TransactionTypeGroup[],
  search: string,
): TransactionTypeGroup[] {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;

  return groups.flatMap((group) => {
    const groupName = group.label.toLocaleLowerCase();
    if (words.every((word) => groupName.includes(word))) return [group];
    const options = group.options.filter(({ label, value }) => {
      const typeName = `${label} ${value}`.toLocaleLowerCase();
      return words.every((word) => typeName.includes(word));
    });
    return options.length > 0 ? [{ ...group, options }] : [];
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
    // Unrecognized keys remain explicit even alongside a completely selected Other group.
    const known = group.options.filter(({ value }) => isRegisteredTransactionType(value));
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
