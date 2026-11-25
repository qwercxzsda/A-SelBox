import type { RawDatasetKey, RawReportKey } from "./api/types.ts";

/** Raw data sub-tabs in display order; Finances is the default. */
export const RAW_DATASETS: readonly RawDatasetKey[] = [
  "finances",
  "ad_invoices",
  "storage",
  "aged_storage",
  "removal_orders",
];

/** The open sub-tab, from the URL (`raw=`) or the saved preference. */
export function decodeRawDataset(value: unknown): RawDatasetKey {
  return RAW_DATASETS.find((key) => key === value) ?? "finances";
}

export function isRawReport(dataset: string): dataset is RawReportKey {
  return dataset !== "finances" && RAW_DATASETS.some((key) => key === dataset);
}
