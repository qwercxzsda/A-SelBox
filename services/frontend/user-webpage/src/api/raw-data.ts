import { adProgramLabel, invoiceLineKindLabel } from "../amazon-codes.ts";
import { readAllCsvRows } from "./pagination.ts";
import { AD_INVOICE_LINE_COLUMNS } from "./raw-columns.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { isUuid } from "./validation.ts";

const OPERATION = "Advertising invoice lines";

export interface AdInvoiceLinesRequest {
  /** The invoice's current version; its lines share it. */
  versionId: string;
  /** line_count stated on the invoice row. */
  lineCount: number;
}

/** Only a campaign line names an ad program, and every code is one the workspace knows. */
function checkLineCodes(row: CanonicalRow): void {
  invoiceLineKindLabel(row.line_kind ?? "", row.adjustment_kind ?? null);
  const program = row.ad_program ?? null;
  if ((row.line_kind === "CAMPAIGN") !== (program !== null))
    throw new Error(`${OPERATION} returned a line whose ad program does not match its kind.`);
  if (program !== null) adProgramLabel(program);
}

/** Lines are numbered 1..n in Amazon's order: campaign lines, then adjustments. */
function requireInvoiceLines(rows: CanonicalRow[], request: AdInvoiceLinesRequest): CanonicalRow[] {
  if (rows.length !== request.lineCount)
    throw new Error(
      `${OPERATION} returned ${String(rows.length)} of ${String(request.lineCount)} lines.`,
    );
  rows.forEach((row, index) => {
    if (row.version_id !== request.versionId || row.line_number !== String(index + 1))
      throw new Error(`${OPERATION} returned a line of another invoice version.`);
    checkLineCodes(row);
  });
  return rows;
}

export function createRawDataApi(transport: ApiTransport) {
  return {
    async fetchAdInvoiceLines(
      accessToken: string,
      request: AdInvoiceLinesRequest,
      signal?: AbortSignal,
    ): Promise<CanonicalRow[]> {
      if (!isUuid(request.versionId)) throw new Error("Choose a valid advertising invoice");
      if (!Number.isSafeInteger(request.lineCount) || request.lineCount < 0)
        throw new Error("The advertising invoice has an invalid line count");
      const rows = await readAllCsvRows(transport, {
        accessToken,
        endpoint: "current_ad_invoice_lines",
        columns: AD_INVOICE_LINE_COLUMNS,
        order: "line_number.asc",
        operation: OPERATION,
        decode: (row) => row,
        identity: (row) => row.id ?? "",
        signal,
        filters: { version_id: `eq.${request.versionId}` },
      });
      return requireInvoiceLines(rows, request);
    },
  };
}
