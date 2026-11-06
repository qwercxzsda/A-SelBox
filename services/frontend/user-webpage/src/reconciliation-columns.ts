import type { DetailColumn } from "./detail-columns";

export const RECONCILIATION_TOTAL_COLUMNS: DetailColumn[] = [
  { key: "currency", label: "Currency" },
  { key: "finances_amount", label: "Finances costs", kind: "amount" },
  { key: "data_kiosk_amount", label: "Data Kiosk costs", kind: "amount" },
  {
    key: "difference",
    label: "Difference (Finances costs - Data Kiosk costs)",
    kind: "amount",
  },
];

export const RECONCILIATION_DETAIL_COLUMNS: DetailColumn[] = [
  { key: "activity_date", label: "Date", kind: "date" },
  { key: "seller_namespace", label: "Source namespace" },
  { key: "marketplace_name", label: "Marketplace", empty: "Not specified", nowrap: true },
  ...RECONCILIATION_TOTAL_COLUMNS,
];
