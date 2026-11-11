import type { CanonicalRow } from "./api/types.ts";
import { sourceCodeLabel } from "./categories.ts";
import { FEE_FAMILIES, type FeeFamily } from "./fee-family-definitions.ts";

const SOURCE_LABELS = { FINANCES: "Finances", DATA_KIOSK: "Data Kiosk" };

const familiesById = new Map<string, FeeFamily>();
const familiesByType = new Map<string, FeeFamily>();
for (const entry of FEE_FAMILIES) {
  if (familiesById.has(entry.id)) throw new Error("Duplicate fee family ID");
  familiesById.set(entry.id, entry);
  for (const [source, types] of [
    ["FINANCES", entry.financesTypes],
    ["DATA_KIOSK", entry.dataKioskTypes],
  ] as const) {
    for (const type of types) {
      const key = JSON.stringify([source, type]);
      if (familiesByType.has(key))
        throw new Error("A source type belongs to multiple fee families");
      familiesByType.set(key, entry);
    }
  }
}

/** Unknown types retain their own exact source identity; nothing enters a shared fallback. */
export function resolveFeeFamily(source: string, type: string): FeeFamily {
  if (
    (source !== "FINANCES" && source !== "DATA_KIOSK") ||
    typeof type !== "string" ||
    type.length === 0 ||
    type.includes("\0")
  )
    throw new Error("Fee family comparison contains an invalid source type");
  return (
    familiesByType.get(JSON.stringify([source, type])) ?? {
      id: `source:${source}:${encodeURIComponent(type)}`,
      label: `${sourceCodeLabel(type)} · ${SOURCE_LABELS[source]}`,
      description: `Unrecognized ${SOURCE_LABELS[source]} type ${type}. Its amount remains separate; no cross-source correspondence is assumed.`,
      financesTypes: source === "FINANCES" ? [type] : [],
      dataKioskTypes: source === "DATA_KIOSK" ? [type] : [],
    }
  );
}

function familyFromId(id: string): FeeFamily | null {
  const registered = familiesById.get(id);
  if (registered) return registered;
  const match = /^source:(FINANCES|DATA_KIOSK):(.+)$/.exec(id);
  if (!match) return null;
  try {
    const entry = resolveFeeFamily(match[1], decodeURIComponent(match[2]));
    return entry.id === id ? entry : null;
  } catch {
    return null;
  }
}

/** Saved navigation may omit malformed IDs, but request filtering validates strictly below. */
export function normalizeFeeFamilyIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input.flatMap((id) => {
        const entry = typeof id === "string" ? familyFromId(id) : null;
        return entry ? [entry.id] : [];
      }),
    ),
  ].sort();
}

/** Strict canonical selection for API filters, comparisons and charts. Empty means all. */
export function selectFeeFamilies(ids: readonly string[]): FeeFamily[] {
  if (!Array.isArray(ids)) throw new Error("Choose valid fee families");
  const entries = ids.map((id) => {
    const entry = typeof id === "string" ? familyFromId(id) : null;
    if (!entry) throw new Error("Choose valid fee families");
    return entry;
  });
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

/** Null means all types. A family without one source produces an empty set for that source. */
export function feeFamilyTypeSelections(ids: readonly string[]): {
  financesTypes: string[];
  dataKioskTypes: string[];
} | null {
  const selected = selectFeeFamilies(ids);
  if (!selected.length) return null;
  return {
    financesTypes: selected.flatMap((entry) => [...entry.financesTypes]),
    dataKioskTypes: selected.flatMap((entry) => [...entry.dataKioskTypes]),
  };
}

/** Retain selected options when the current period has no rows for them. */
export function buildFeeFamilyOptions(
  rows: readonly CanonicalRow[],
  selectedIds: readonly string[] = [],
): FeeFamily[] {
  const entries = new Map(selectFeeFamilies(selectedIds).map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const entry = resolveFeeFamily(row.source ?? "", row.component_type ?? "");
    entries.set(entry.id, entry);
  }
  return [...entries.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  );
}
