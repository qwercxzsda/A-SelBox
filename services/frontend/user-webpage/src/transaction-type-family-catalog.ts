import { TRANSACTION_TYPE_GROUPS, TYPES_BY_GROUP } from "./transaction-type-families.ts";
const groups = new Map(
  TRANSACTION_TYPE_GROUPS.flatMap((group) =>
    TYPES_BY_GROUP[group.id].map((type) => [type, group] as const),
  ),
);
const other = TRANSACTION_TYPE_GROUPS.find((group) => group.id === "other");
export function transactionTypeGroup(type: string) {
  const group = groups.get(type) ?? other;
  if (!group) throw new Error("Missing transaction type group");
  return group;
}
export function isRegisteredTransactionType(type: string) {
  return groups.has(type);
}
