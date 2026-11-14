import type { CurrencyTotal, TransactionTypeTotal } from "./api/types.ts";
import { sumExactDecimals } from "./decimal.ts";
import { transactionTypeGroup } from "./transaction-type-family-catalog.ts";

import { TRANSACTION_TYPE_GROUPS, type TypeGroupId } from "./transaction-type-families.ts";

export interface TransactionTypeGroup {
  id: TypeGroupId;
  label: string;
  totals: CurrencyTotal;
  types: TransactionTypeTotal[];
}

function salesOrder(type: string): number {
  if (type === "PRODUCT_SALES") return 0;
  if (type === "PRODUCT_REFUNDS") return 1;
  return type === "NET_PRODUCT_SALES" ? 2 : 3;
}

function compareTypes(left: TransactionTypeTotal, right: TransactionTypeTotal): number {
  const rank = salesOrder(left.type) - salesOrder(right.type);
  return rank || (left.type < right.type ? -1 : left.type > right.type ? 1 : 0);
}

function sumTypes(rows: readonly TransactionTypeTotal[], currency: string): CurrencyTotal {
  return {
    currency,
    reportedAmount: sumExactDecimals(rows.map((row) => row.reportedAmount)),
    serviceFee: sumExactDecimals(rows.map((row) => row.serviceFee)),
    companyAmount: sumExactDecimals(rows.map((row) => row.companyAmount)),
    rowCount: rows.reduce((count, row) => count + row.rowCount, 0),
    missingFeeCount: rows.reduce((count, row) => count + row.missingFeeCount, 0),
  };
}

export function totalTransactionTypes(
  rows: readonly TransactionTypeTotal[],
  currency: string,
): CurrencyTotal {
  return sumTypes(
    rows.filter((row) => row.currency === currency),
    currency,
  );
}

export function groupTransactionTypes(
  rows: readonly TransactionTypeTotal[],
  currency: string,
): TransactionTypeGroup[] {
  const grouped = new Map<TypeGroupId, Omit<TransactionTypeGroup, "totals">>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const definition = transactionTypeGroup(row.type);
    const group = grouped.get(definition.id) ?? {
      id: definition.id,
      label: definition.label,
      types: [],
    };
    group.types.push(row);
    grouped.set(definition.id, group);
  }
  return TRANSACTION_TYPE_GROUPS.flatMap(({ id }) => {
    const group = grouped.get(id);
    return group
      ? [
          {
            ...group,
            totals: sumTypes(group.types, currency),
            types: group.types.sort(compareTypes),
          },
        ]
      : [];
  });
}
