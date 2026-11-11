import { requireCalendarDate, textSelectionValues } from "./filters.ts";
import { decodeTypeTotals } from "./aggregates.ts";
import { readOffsetRpcRows } from "./rpc-pagination.ts";
import { DETAIL_PAGE_SIZE, LOOKUP_PAGE_SIZE, validatePagination } from "./pagination.ts";
import { isJsonObject, requireCurrency, requireUuid } from "./validation.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow, PageResult } from "./types.ts";
import { parseExactCount } from "./content-range.ts";
import { sumExactDecimals } from "../decimal.ts";

const PAYOUT_RECORD_COLUMNS = [
  "report_id",
  "source_row_id",
  "source_version_id",
  "source_identity_id",
  "sku_id",
  "terms_version_id",
  "fee_period_id",
  "authoritative",
  "source",
  "sku",
  "marketplace_name",
  "activity_date",
  "component_type",
  "currency",
  "source_amount",
  "quantity",
  "fee_base",
  "fee_rate_percent",
  "fee_amount",
  "company_amount",
  "resolution_status",
] as const;

function decodePayoutRecords(
  value: unknown,
  reportId: string,
  authoritative: boolean,
  offset: number,
): PageResult {
  if (!isJsonObject(value) || !Array.isArray(value.rows))
    throw new Error("Payout records returned invalid rows");
  const totalCount = parseExactCount(value.total_count);
  if (value.rows.length !== Math.min(DETAIL_PAGE_SIZE, Math.max(0, totalCount - offset)))
    throw new Error("Payout records returned an incomplete page");
  const identities = new Set<string>();
  const rows = value.rows.map((record): CanonicalRow => {
    if (!isJsonObject(record)) throw new Error("Payout records returned an invalid row");
    const row: CanonicalRow = Object.create(null) as CanonicalRow;
    for (const column of PAYOUT_RECORD_COLUMNS) {
      const field = record[column];
      if (field !== null && typeof field !== "string")
        throw new Error(`Payout records returned invalid ${column}`);
      row[column] = field;
    }
    if (
      row.report_id !== reportId ||
      row.authoritative !== String(authoritative) ||
      (row.source !== "FINANCES" && row.source !== "DATA_KIOSK") ||
      !row.source_row_id
    )
      throw new Error("Payout records returned an invalid identity or scope");
    requireCalendarDate(row.activity_date ?? "");
    requireCurrency(row.currency);
    for (const field of [
      "source_amount",
      "quantity",
      "fee_base",
      "fee_rate_percent",
      "fee_amount",
      "company_amount",
    ])
      if (row[field] !== null) sumExactDecimals([row[field]]);
    const identity = `${row.report_id}:${row.source}:${row.source_row_id}`;
    if (identities.has(identity)) throw new Error("Payout records repeated a source identity");
    identities.add(identity);
    return row;
  });
  return { rows, totalCount };
}

export function createPayoutApi(transport: ApiTransport) {
  return {
    async fetchPayoutRecords(
      accessToken: string,
      reportId: string,
      authoritative: boolean,
      pageIndex: number,
      signal?: AbortSignal,
      types: string[] = [],
    ) {
      requireUuid(reportId, "report");
      validatePagination(pageIndex, DETAIL_PAGE_SIZE);
      if (typeof authoritative !== "boolean") throw new Error("Choose a valid payout record scope");
      const offset = pageIndex * DETAIL_PAGE_SIZE;
      const selectedTypes = textSelectionValues("component_type", types);
      const value = await transport.postRpc(
        accessToken,
        "payout_report_records",
        {
          p_report_id: reportId,
          p_authoritative: authoritative,
          p_limit: DETAIL_PAGE_SIZE,
          p_offset: offset,
          p_types: selectedTypes.length ? selectedTypes : null,
        },
        "Payout details",
        signal,
      );
      return decodePayoutRecords(value, reportId, authoritative, offset);
    },
    async fetchPayoutTypeTotals(
      accessToken: string,
      reportId: string,
      currency: string,
      signal?: AbortSignal,
    ) {
      requireUuid(reportId, "report");
      return readOffsetRpcRows(
        (offset) =>
          transport.postRpc(
            accessToken,
            "payout_report_totals",
            {
              p_report_id: reportId,
              p_group_by_type: true,
              p_limit: LOOKUP_PAGE_SIZE,
              p_offset: offset,
            },
            "Payout amounts by type",
            signal,
          ),
        (rows) => decodeTypeTotals(rows, currency),
        (row) => row.type,
        "Payout amounts by type",
        signal,
      );
    },
  };
}
