import type { DetailColumn } from "./detail-columns";

export const RECONCILIATION_TOTAL_COLUMNS: DetailColumn[] = [
  { key: "currency", label: "Currency" },
  { key: "data_kiosk_finances_control", label: "Finances costs", kind: "amount" },
  { key: "data_kiosk_category_amount", label: "Data Kiosk costs", kind: "amount" },
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
  { key: "finances_category_amount", label: "Finances category", kind: "amount" },
  { key: "selbox_category_amount", label: "SelBox category", kind: "amount" },
  { key: "finances_total", label: "Finances total", kind: "amount" },
  { key: "accounted_total", label: "Total after adding difference", kind: "amount" },
];
