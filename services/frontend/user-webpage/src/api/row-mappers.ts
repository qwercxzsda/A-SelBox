import { DATASET_CONFIG } from "./config.ts";
import type { CanonicalRow, TableDatasetKey } from "./types.ts";
import { isJsonObject } from "./validation.ts";
import { validateAccountDirectoryRow } from "./account-directory.ts";
import { payoutMarketplace } from "../payout-report-scope.ts";
import { parseRecordTimestamp } from "../date-display.ts";
import { isRawReport } from "../raw-data-view.ts";
import { checkRawReportRow } from "../raw-report-rows.ts";

export function mapDatasetRows(dataset: TableDatasetKey, records: unknown[]): CanonicalRow[] {
  const config = DATASET_CONFIG[dataset];
  return records.map((record) => {
    if (!isJsonObject(record)) throw new Error("Data response returned an invalid row");
    const row: CanonicalRow = Object.create(null) as CanonicalRow;
    for (const column of config.selectColumns) {
      const value = record[column];
      if (value !== null && typeof value !== "string") {
        throw new Error(`Data response has an invalid ${column}`);
      }
      row[column] = value;
    }
    for (const column of config.idColumns) {
      if (row[column] === null || row[column] === "") {
        throw new Error(`Data response is missing required identifier ${column}`);
      }
    }
    if (dataset === "payouts") payoutMarketplace(row);
    if (dataset === "accounts") validateAccountDirectoryRow(row);
    if (isRawReport(dataset)) checkRawReportRow(dataset, row);
    if (
      (dataset === "live" || dataset === "finances") &&
      (!row.activity_at || !parseRecordTimestamp(row.activity_at))
    )
      throw new Error("Data response has an invalid transaction timestamp");
    return row;
  });
}
