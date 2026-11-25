import marketplaces from "./generated/marketplaces.json" with { type: "json" };
import type { FilterOption } from "./filter-options.ts";
import { companyLabel } from "./view-model.ts";

// Column-menu selections and applied chips shared by the lists loaded once (Current fees and
// Assignments). Known values are constants; only data such as companies comes from the account.

/** A column menu's selection filter, without its kind. */
export interface SelectionMenu {
  value: string[];
  options: FilterOption[];
  onChange: (values: string[]) => void;
}

/** Fixed codes in their defined order, shown by label; unknown values are dropped. */
export function codeMenu<Code extends string>(
  codes: readonly Code[],
  labels: Record<Code, string>,
  selected: readonly Code[],
  onChange: (selected: Code[]) => void,
): SelectionMenu {
  return {
    value: [...selected],
    options: codes.map((value) => ({ value, label: labels[value] })),
    onChange: (values) => {
      onChange(codes.filter((code) => values.includes(code)));
    },
  };
}

/** Every company plus Unassigned, by name. IDs are JSON-encoded so Unassigned (null) survives. */
export function companyMenu(
  selected: readonly (string | null)[],
  companies: Map<string, string>,
  onChange: (selected: (string | null)[]) => void,
): SelectionMenu {
  return {
    value: selected.map((id) => JSON.stringify(id)),
    options: [...new Set([...companies.keys(), ...selected, null])]
      .map((id) => ({ value: JSON.stringify(id), label: companyLabel(id, companies) }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    onChange: (values) => {
      onChange(values.map((value) => JSON.parse(value) as string | null));
    },
  };
}

/** The constant marketplace list, never values collected from the loaded rows. */
export function marketplaceMenu(
  selected: readonly string[],
  onChange: (selected: string[]) => void,
): SelectionMenu {
  return {
    value: [...selected],
    options: marketplaces.map((value) => ({ value, label: value })),
    onChange: (values) => {
      onChange(marketplaces.filter((marketplace) => values.includes(marketplace)));
    },
  };
}

/** One removable "<Filter>: <value>" chip per selected value. */
export function selectionChips<Value, Change>(
  filter: string,
  selected: readonly Value[],
  label: (value: Value) => string,
  clear: (remaining: Value[]) => Change,
) {
  return selected.map((value) => ({
    key: `${filter}:${JSON.stringify(value)}`,
    label: `${filter}: ${label(value)}`,
    clear: clear(selected.filter((other) => other !== value)),
  }));
}
