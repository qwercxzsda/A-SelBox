import { mapDatasetRows } from "./row-mappers.ts";
import { validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import type { FinancialReviewSource } from "./financial-review.ts";
import { isJsonObject, isUuid } from "./validation.ts";

const SOURCE_LOOKUP_PAGE_SIZE = 25;

export interface FinancialSourceSelection {
  source: FinancialReviewSource;
  rowId: string;
  versionId: string;
}

export function decodeFinancialSourceSelection(value: unknown): FinancialSourceSelection | null {
  if (!isJsonObject(value)) return null;
  if (value.source !== "FINANCES" && value.source !== "DATA_KIOSK") return null;
  if (!isUuid(value.rowId) || !isUuid(value.versionId)) return null;
  return { source: value.source, rowId: value.rowId, versionId: value.versionId };
}

export function createFinancialSourceApi(transport: ApiTransport) {
  return {
    async fetchFinancialSourceRecord(
      accessToken: string,
      selection: FinancialSourceSelection,
      signal?: AbortSignal,
    ): Promise<CanonicalRow | null> {
      if (!decodeFinancialSourceSelection(selection))
        throw new Error("Choose a valid source record");
      const record = await transport.postRpc(
        accessToken,
        "financial_source_record",
        {
          p_source: selection.source,
          p_row_id: selection.rowId,
          p_version_id: selection.versionId,
        },
        "Source record",
        signal,
      );
      if (record === null) return null;
      const [row] = mapDatasetRows(selection.source === "FINANCES" ? "finances" : "data_kiosk", [
        record,
      ]);
      if (
        row.id !== selection.rowId ||
        (selection.source === "FINANCES" ? row.version_id : row.version_id) !== selection.versionId
      )
        throw new Error("Source detail returned a different row or version");
      return row;
    },
    async fetchFinancialSourceTransactions(
      accessToken: string,
      transactionId: string,
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<{ rows: CanonicalRow[]; hasNext: boolean }> {
      if (!transactionId.trim() || transactionId.length > 512)
        throw new Error("Enter an exact Amazon transaction ID");
      validatePagination(pageIndex, SOURCE_LOOKUP_PAGE_SIZE);
      const records = await transport.postRpc(
        accessToken,
        "financial_source_transaction_lookup",
        {
          p_native_transaction_id: transactionId,
          p_limit: SOURCE_LOOKUP_PAGE_SIZE + 1,
          p_offset: pageIndex * SOURCE_LOOKUP_PAGE_SIZE,
        },
        "Amazon transaction lookup",
        signal,
      );
      if (!Array.isArray(records) || records.length > SOURCE_LOOKUP_PAGE_SIZE + 1)
        throw new Error("Amazon transaction lookup returned invalid rows");
      const rows = mapDatasetRows("finances", records);
      for (let index = 0; index < rows.length; index += 1) {
        const record: unknown = records[index];
        if (
          !isJsonObject(record) ||
          (record.capture_status !== "Current" && record.capture_status !== "Retained")
        )
          throw new Error("Amazon transaction lookup returned an invalid capture status");
        if (rows[index].native_transaction_id !== transactionId)
          throw new Error("Amazon transaction lookup returned a different transaction");
        rows[index].capture_status = record.capture_status;
      }
      return {
        rows: rows.slice(0, SOURCE_LOOKUP_PAGE_SIZE),
        hasNext: rows.length > SOURCE_LOOKUP_PAGE_SIZE,
      };
    },
  };
}
