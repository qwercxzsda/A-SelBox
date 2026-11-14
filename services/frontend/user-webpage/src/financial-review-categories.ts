import type { DetailColumn } from "./detail-columns";
import type { FinancialReviewCategory } from "./api/financial-review";
import type { CanonicalRow } from "./api/types";

export type ReviewCategory = FinancialReviewCategory;

export const REVIEW_CATEGORIES: { value: ReviewCategory; label: string; description: string }[] = [
  {
    value: "FINANCES",
    label: "Finances",
    description:
      "Sales, refunds and transaction fees, grouped with their signed offsets. Company calculations use Finances amounts; comparison dates and coverage may differ in Data Kiosk.",
  },
  {
    value: "DATA_KIOSK",
    label: "Data Kiosk",
    description:
      "Allocated costs such as advertising and storage. Data Kiosk supplies company costs; Finances account controls support comparison where types are mapped.",
  },
  {
    value: "SELBOX",
    label: "SelBox",
    description:
      "Seller account charges, credits, adjustments and balance movements. Some activity has no verified Data Kiosk mapping. These are native account amounts, separate from company allocations and service fees.",
  },
];

export function reviewCategory(value: unknown): ReviewCategory {
  return value === "FINANCES" || value === "SELBOX" ? value : "DATA_KIOSK";
}

export function reviewCategoryLabel(category: ReviewCategory): string {
  return REVIEW_CATEGORIES.find(({ value }) => value === category)?.label ?? category;
}

/** A zero used in source-gap arithmetic is not a mapped counterpart amount. */
export function isUnmappedSourceAmount(row: CanonicalRow, field: string): boolean {
  return (
    (field === "finances_amount" || field === "data_kiosk_amount") &&
    row[field.replace("_amount", "_expected")] === "false"
  );
}

/** Only a mapped source can be described as having no records. */
export function hasNoSourceRecords(row: CanonicalRow, field: string): boolean {
  return (
    (field === "finances_amount" || field === "data_kiosk_amount") &&
    !isUnmappedSourceAmount(row, field) &&
    row[field.replace("_amount", "_row_count")] === "0"
  );
}

export function reviewAmountColumns(category: ReviewCategory): DetailColumn[] {
  const amount = category === "DATA_KIOSK" ? "costs" : "amount";
  return [
    { key: "currency", label: "Currency" },
    { key: "finances_amount", label: `Finances ${amount}`, kind: "amount" },
    { key: "data_kiosk_amount", label: `Data Kiosk ${amount}`, kind: "amount" },
    {
      key: "difference",
      label: `Source gap (Finances ${amount} - Data Kiosk ${amount})`,
      kind: "amount",
    },
  ];
}
