import type { DetailColumn } from "./detail-columns";
import type { FinancialReviewCategory } from "./api/financial-review";

export type ReviewCategory = FinancialReviewCategory;

export const REVIEW_CATEGORIES: { value: ReviewCategory; label: string; description: string }[] = [
  {
    value: "FINANCES",
    label: "Finances",
    description:
      "Sales, refunds and transaction fees, grouped with their signed offsets. Mature company calculations use Finances amounts; comparison dates and coverage may differ in Data Kiosk.",
  },
  {
    value: "DATA_KIOSK",
    label: "Data Kiosk",
    description:
      "Allocated costs such as advertising and storage. Data Kiosk supplies company costs; Finances provides the comparison.",
  },
  {
    value: "SELBOX",
    label: "SelBox",
    description:
      "Seller service fees, account adjustments and balance movements. Some families have no Data Kiosk counterpart. These amounts exclude company allocations, retained service fees and the derived Data Kiosk difference.",
  },
];

export function reviewCategory(value: unknown): ReviewCategory {
  return value === "FINANCES" || value === "SELBOX" ? value : "DATA_KIOSK";
}

export function reviewCategoryLabel(category: ReviewCategory): string {
  return REVIEW_CATEGORIES.find(({ value }) => value === category)?.label ?? category;
}

export function reviewAmountColumns(category: ReviewCategory): DetailColumn[] {
  const amount = category === "DATA_KIOSK" ? "costs" : "amount";
  return [
    { key: "currency", label: "Currency" },
    { key: "finances_amount", label: `Finances ${amount}`, kind: "amount" },
    { key: "data_kiosk_amount", label: `Data Kiosk ${amount}`, kind: "amount" },
    {
      key: "difference",
      label: `Difference (Finances ${amount} - Data Kiosk ${amount})`,
      kind: "amount",
    },
  ];
}
