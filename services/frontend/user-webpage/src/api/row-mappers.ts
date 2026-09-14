import { DATASET_CONFIG } from "./config.ts";
import type { CsvRecord } from "./csv.ts";
import type { CanonicalRow, DatasetKey } from "./types.ts";

export function mapDatasetRows(dataset: DatasetKey, records: CsvRecord[]): CanonicalRow[] {
  const config = DATASET_CONFIG[dataset];
  return records.map((record) => {
    const row: CanonicalRow = Object.create(null) as CanonicalRow;
    for (const column of config.selectColumns) {
      if (!Object.hasOwn(record, column)) {
        throw new Error(`CSV response is missing column ${column}`);
      }
      row[column] = record[column];
    }
    for (const column of config.idColumns) {
      if (row[column] === null || row[column] === "") {
        throw new Error(`CSV response is missing required identifier ${column}`);
      }
    }
    return row;
  });
}
