import type { CanonicalRow } from "./api/types.ts";
import { sourceCodeLabel } from "./categories.ts";
import {
  TRANSACTION_TYPE_FAMILIES,
  TRANSACTION_TYPE_GROUPS,
  type TypeFamily,
  type TypeFamilySource,
  type TypeGroupDefinition,
} from "./transaction-type-families.ts";

const SOURCE_LABELS = { FINANCES: "Finances", DATA_KIOSK: "Data Kiosk" };

const groupsById = new Map<string, TypeGroupDefinition>(
  TRANSACTION_TYPE_GROUPS.map((group) => [group.id, group]),
);
if (groupsById.size !== TRANSACTION_TYPE_GROUPS.length) throw new Error("Duplicate type group ID");

const familiesById = new Map<string, TypeFamily>();
const typesByCode = new Map<string, { family: TypeFamily; sources: Set<TypeFamilySource> }>();
for (const entry of TRANSACTION_TYPE_FAMILIES) {
  if (!groupsById.has(entry.groupId)) throw new Error("A type family has an unknown group");
  if (familiesById.has(entry.id)) throw new Error("Duplicate type family ID");
  familiesById.set(entry.id, entry);
  for (const [source, types] of [
    ["FINANCES", entry.financesTypes],
    ["DATA_KIOSK", entry.dataKioskTypes],
  ] as const) {
    for (const type of types) {
      const registered = typesByCode.get(type) ?? {
        family: entry,
        sources: new Set<TypeFamilySource>(),
      };
      if (registered.family !== entry)
        throw new Error("A type belongs to different families across sources");
      if (registered.sources.has(source))
        throw new Error("A source type is registered more than once");
      registered.sources.add(source);
      typesByCode.set(type, registered);
    }
  }
}

/** The shared broad group follows the detailed family's declared parent. */
export function transactionTypeGroup(type: string): TypeGroupDefinition {
  const group = groupsById.get(typesByCode.get(type)?.family.groupId ?? "other");
  if (!group) throw new Error("Missing transaction type group");
  return group;
}

/** Unknown selections remain explicit even when every registered Other type is selected. */
export function isRegisteredTransactionType(type: string): boolean {
  return typesByCode.has(type);
}

/** Detailed family ordering for financial review. */
export function compareTypeFamilies(
  left: Pick<TypeFamily, "id" | "label">,
  right: Pick<TypeFamily, "id" | "label">,
): number {
  return left.label.localeCompare(right.label, "en") || left.id.localeCompare(right.id, "en");
}

/** Unknown types retain their own exact source identity; nothing enters a shared fallback. */
export function resolveTypeFamily(source: string, type: string): TypeFamily {
  if (
    (source !== "FINANCES" && source !== "DATA_KIOSK") ||
    typeof type !== "string" ||
    type.length === 0 ||
    type.includes("\0")
  )
    throw new Error("Type family comparison contains an invalid source type");
  const registered = typesByCode.get(type);
  if (registered?.sources.has(source)) return registered.family;
  return {
    id: `source:${source}:${encodeURIComponent(type)}`,
    groupId: "other",
    label: `${sourceCodeLabel(type)} · ${SOURCE_LABELS[source]}`,
    description: `Unrecognized ${SOURCE_LABELS[source]} type ${type}. Its amount remains separate; no cross-source correspondence is assumed.`,
    financesTypes: source === "FINANCES" ? [type] : [],
    dataKioskTypes: source === "DATA_KIOSK" ? [type] : [],
  };
}

function familyFromId(id: unknown): TypeFamily | null {
  if (typeof id !== "string") return null;
  const registered = familiesById.get(id);
  if (registered) return registered;
  const match = /^source:(FINANCES|DATA_KIOSK):(.+)$/.exec(id);
  if (!match) return null;
  try {
    const entry = resolveTypeFamily(match[1], decodeURIComponent(match[2]));
    return entry.id === id ? entry : null;
  } catch {
    return null;
  }
}

/** Saved navigation may omit malformed IDs, but request filtering validates strictly below. */
export function normalizeTypeFamilyIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input.flatMap((id) => {
        const entry = familyFromId(id);
        return entry ? [entry.id] : [];
      }),
    ),
  ].sort();
}

/** Strict canonical selection for API filters, comparisons and charts. Empty means all. */
export function selectTypeFamilies(ids: readonly string[]): TypeFamily[] {
  if (!Array.isArray(ids)) throw new Error("Choose valid type families");
  const entries = ids.map((id) => {
    const entry = familyFromId(id);
    if (!entry) throw new Error("Choose valid type families");
    return entry;
  });
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

/** Null means all types. A family without one source produces an empty set for that source. */
export function typeFamilyTypeSelections(ids: readonly string[]): {
  financesTypes: string[];
  dataKioskTypes: string[];
} | null {
  const selected = selectTypeFamilies(ids);
  if (!selected.length) return null;
  return {
    financesTypes: selected.flatMap((entry) => entry.financesTypes),
    dataKioskTypes: selected.flatMap((entry) => entry.dataKioskTypes),
  };
}

/** Retain selected options when the current period has no rows for them. */
export function buildTypeFamilyOptions(
  rows: readonly CanonicalRow[],
  selectedIds: readonly string[] = [],
): TypeFamily[] {
  const entries = new Map(selectTypeFamilies(selectedIds).map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const entry = resolveTypeFamily(row.source ?? "", row.component_type ?? "");
    entries.set(entry.id, entry);
  }
  return [...entries.values()].sort(compareTypeFamilies);
}
