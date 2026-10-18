import { FINANCIAL_AMOUNTS } from "./financial-amounts";

export interface DetailColumn {
  key: string;
  label: string;
  kind?: "amount" | "number" | "source" | "type" | "date";
  empty?: string;
  nowrap?: boolean;
}

export function financialAmountColumns(currency: string, authoritative = true): DetailColumn[] {
  return FINANCIAL_AMOUNTS.filter(([field]) => authoritative || field === "reportedAmount").map(
    ([, label, recordField]) => ({
      key: recordField,
      label: currency ? `${label} (${currency})` : label,
      kind: "amount",
    }),
  );
}
