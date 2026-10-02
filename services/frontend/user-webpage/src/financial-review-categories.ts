import type { DetailColumn } from "./detail-columns";
import type { FinancialReviewCategory } from "./api/financial-review";

export type ReviewCategory = FinancialReviewCategory;

export const REVIEW_CATEGORIES: { value: ReviewCategory; label: string; description: string }[] = [
  {
    value: "SETTLEMENT",
    label: "Settlement",
    description:
      "Sales, refunds and transaction fees. Mature company calculations use Settlement amounts; Data Kiosk provides a source comparison.",
  },
  {
    value: "DATA_KIOSK",
    label: "Data Kiosk",
    description:
      "Allocated costs such as advertising and storage. Data Kiosk supplies company costs; Settlement provides the comparison.",
  },
  {
    value: "SELBOX",
    label: "SelBox",
    description:
      "Account charges and balance movements. These category amounts exclude company allocations, retained service fees and the derived Data Kiosk difference.",
  },
];

export function reviewCategory(value: unknown): ReviewCategory {
  return value === "SETTLEMENT" || value === "SELBOX" ? value : "DATA_KIOSK";
}

export function reviewCategoryLabel(category: ReviewCategory): string {
  return REVIEW_CATEGORIES.find(({ value }) => value === category)?.label ?? category;
}

export function reviewAmountColumns(category: ReviewCategory): DetailColumn[] {
  const amount = category === "DATA_KIOSK" ? "costs" : "amount";
  return [
    { key: "currency", label: "Currency" },
    { key: "settlement_amount", label: `Settlement ${amount}`, kind: "number" },
    { key: "data_kiosk_amount", label: `Data Kiosk ${amount}`, kind: "number" },
    {
      key: "difference",
      label: `Difference (Settlement ${amount} - Data Kiosk ${amount})`,
      kind: "number",
    },
  ];
}
