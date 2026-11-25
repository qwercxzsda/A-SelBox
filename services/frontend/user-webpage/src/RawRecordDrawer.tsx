import type { CanonicalRow, RawReportKey } from "./api";
import type { Identity } from "./auth-session";
import { AdInvoiceLines } from "./AdInvoiceLines";
import { AdditionalDetails } from "./AdditionalDetails";
import { DetailDrawer } from "./DetailDrawer";
import { DetailFields, type DetailField } from "./DetailFields";
import { DetailSection } from "./DetailSection";
import {
  RAW_RECORD_TITLES,
  rawRecordCalculations,
  rawRecordContext,
  rawRecordFields,
  rawRecordSource,
} from "./raw-record-fields";
import { SkuTransactionLink } from "./SkuTransactionLink";

/**
 * One row of an Amazon report: the fields Amazon printed, what SelBox calculated from them, then
 * where the row came from.
 */
export function RawRecordDrawer({
  identity,
  dataset,
  row,
  onClose,
  onShowTransactions,
}: {
  identity: Identity;
  dataset: RawReportKey;
  row: CanonicalRow | null;
  onClose: () => void;
  onShowTransactions?: (sku: string) => void;
}) {
  // A printed SKU links to Transactions only when it is exactly a catalog SKU.
  const printedFields = (record: CanonicalRow): DetailField[] =>
    rawRecordFields(dataset, record).map((field) =>
      field.key === "sku_printed" && onShowTransactions && identity.skuOptions.includes(field.value)
        ? {
            ...field,
            value: <SkuTransactionLink sku={field.value} onShowTransactions={onShowTransactions} />,
          }
        : field,
    );
  return (
    <DetailDrawer
      id="selected-row-details"
      opened={row !== null}
      onClose={onClose}
      width="record"
      title={RAW_RECORD_TITLES[dataset]}
      context={row ? rawRecordContext(dataset, row) : ""}
    >
      {row ? (
        <div role="group" aria-label="Record details">
          <DetailFields fields={printedFields(row)} />
          {dataset === "ad_invoices" ? (
            <DetailSection title="Lines">
              <AdInvoiceLines identity={identity} invoice={row} />
            </DetailSection>
          ) : null}
          <DetailSection
            title="Calculated by SelBox"
            help="SelBox works these out from Amazon's values. Amazon does not print them."
          >
            <DetailFields fields={rawRecordCalculations(dataset, row)} />
          </DetailSection>
          <AdditionalDetails
            key={row.id}
            stateKey={`raw:${dataset}:metadata`}
            rows={rawRecordSource(dataset, row)}
          />
        </div>
      ) : null}
    </DetailDrawer>
  );
}
