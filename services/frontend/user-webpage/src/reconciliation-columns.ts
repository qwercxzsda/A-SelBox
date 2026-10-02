import type { DetailColumn } from "./detail-columns";

export const RECONCILIATION_TOTAL_COLUMNS: DetailColumn[] = [
  { key: "currency", label: "Currency" },
  { key: "data_kiosk_settlement_control", label: "Settlement costs", kind: "number" },
  { key: "data_kiosk_category_amount", label: "Data Kiosk costs", kind: "number" },
  {
    key: "difference",
    label: "Difference (Settlement costs - Data Kiosk costs)",
    kind: "number",
  },
];

export const RECONCILIATION_DETAIL_COLUMNS: DetailColumn[] = [
  { key: "activity_date", label: "Date", kind: "date" },
  { key: "seller_namespace", label: "Source namespace" },
  { key: "marketplace_name", label: "Marketplace", empty: "Not specified", nowrap: true },
  ...RECONCILIATION_TOTAL_COLUMNS,
  { key: "settlement_category_amount", label: "Settlement category", kind: "number" },
  { key: "selbox_category_amount", label: "SelBox category", kind: "number" },
  { key: "settlement_total", label: "Settlement total", kind: "number" },
  { key: "accounted_total", label: "Total after adding difference", kind: "number" },
];
