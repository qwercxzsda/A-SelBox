import type { CanonicalRow, RawReportKey } from "./api/types.ts";
import { invoiceStatusLabel, regionLabel } from "./amazon-codes.ts";
import {
  compareDecimals,
  formatExactDecimal,
  formatExactMoney,
  isDecimal,
  sumExactDecimals,
} from "./decimal.ts";

/**
 * SelBox splits each printed report fee into base and tax. The tax is either inside the fee
 * (fee = base + tax) or charged on top of it (fee = base). A zero tax satisfies both and reads
 * "included". Any other split is an error.
 */
export function reportTaxLabel(row: CanonicalRow): "Tax included" | "Tax added" | null {
  const fee = row.fee_amount ?? null;
  const base = row.base_amount ?? null;
  const tax = row.tax_amount ?? null;
  if (fee === null && base === null && tax === null) return null;
  const total = sumExactDecimals([base, tax]);
  if (fee === null || base === null || tax === null || total === null)
    throw new Error("A report fee needs its base and tax amounts");
  if (compareDecimals(fee, total) === 0) return "Tax included";
  if (compareDecimals(fee, base) === 0) return "Tax added";
  throw new Error(`Report fee ${fee} is neither base ${base} plus tax ${tax} nor the base alone`);
}

/** The line beneath a report fee: "Tax included: 5 JPY". */
export function reportTaxNote(row: CanonicalRow): string | null {
  const label = reportTaxLabel(row);
  return label && `${label}: ${formatExactMoney(row.tax_amount ?? null, row.currency ?? null)}`;
}

/**
 * The quantity Amazon fills for each removal order type; it leaves the other one blank. A
 * Liquidations order states its shipped quantity, like a Return.
 */
const REMOVAL_QUANTITIES: Readonly<Record<string, readonly [key: string, label: string]>> = {
  Disposal: ["disposed_quantity", "Disposed"],
  Return: ["shipped_quantity", "Shipped"],
  Liquidations: ["shipped_quantity", "Shipped"],
};

/** The line beneath a removal order's requested quantity: "Disposed: 2" or "Shipped: 4". */
export function removalQuantityNote(row: CanonicalRow): string {
  const type = row.order_type ?? "";
  if (!Object.hasOwn(REMOVAL_QUANTITIES, type))
    throw new Error(`Unknown removal order type ${type}`);
  const [key, label] = REMOVAL_QUANTITIES[type];
  const quantity = row[key] ?? null;
  if (quantity === null || !isDecimal(quantity))
    throw new Error(`A ${type} removal order row has an invalid ${key}`);
  return `${label}: ${formatExactDecimal(quantity)}`;
}

/** The two volume units Amazon prints, with the singular a rate is stated per. */
const VOLUME_UNITS: Readonly<Record<string, string>> = {
  "cubic feet": "cubic foot",
  "cubic meters": "cubic meter",
};

/** A figure Amazon printed on a storage row: present, decimal and not negative. */
function storageFigure(row: CanonicalRow, key: string): string {
  const value = row[key] ?? null;
  if (value === null || !isDecimal(value) || compareDecimals(value, "0") < 0)
    throw new Error(`A monthly storage row has an invalid ${key}`);
  return value;
}

function volumeUnit(row: CanonicalRow): string {
  const unit = row.volume_units ?? "";
  if (!Object.hasOwn(VOLUME_UNITS, unit)) throw new Error(`Unknown storage volume unit ${unit}`);
  return unit;
}

/**
 * "0.0008 cubic meters": a volume Amazon printed, with the report's unit. By default Amazon's
 * estimated total item volume.
 */
export function storageVolume(row: CanonicalRow, key = "estimated_total_item_volume"): string {
  return `${formatExactDecimal(storageFigure(row, key))} ${volumeUnit(row)}`;
}

type StorageField = readonly [key: string, label: string];
type StorageEntry = [key: string, label: string, value: string];
const ONE_RATE: readonly StorageField[] = [["storage_rate", "Storage rate"]];
const TWO_RATES: readonly StorageField[] = [
  ["base_rate", "Base rate"],
  ["utilization_surcharge_rate", "Utilization surcharge rate"],
];
const UTILIZATION_RATIO = "storage_utilization_ratio";
const SURCHARGE_VOLUME = "est_vol_for_sus";
/** Amazon's split of a two-rate fee. The two parts add up to the fee within 0.0001. */
const FEE_SPLIT: readonly StorageField[] = [
  ["est_base_msf", "Estimated base storage fee"],
  ["est_sus", "Estimated utilization surcharge"],
];
/** Amazon prints the ratio as a number of weeks, or as ">52". */
const UTILIZATION_RATIO_FORMAT = /^(?:>52|\d+(?:\.\d+)?)$/;

function utilizationRatio(row: CanonicalRow): string {
  const ratio = row[UTILIZATION_RATIO] ?? "";
  if (!UTILIZATION_RATIO_FORMAT.test(ratio))
    throw new Error(`A monthly storage row has an invalid ${UTILIZATION_RATIO}`);
  return `${ratio} weeks`;
}

/**
 * Amazon's figures behind a storage fee, in the form the report printed. Australia and Singapore
 * state one storage rate. Europe, Japan and North America state a base rate and a utilization
 * surcharge rate, with the storage utilization ratio, the volume the surcharge applies to and the
 * fee split into a base fee and a surcharge. A rate is in the report currency per unit of volume:
 * "13.2 SGD per cubic meter".
 */
export function storageFeeBasis(row: CanonicalRow): StorageEntry[] {
  const stated = (key: string) => (row[key] ?? null) !== null;
  const twoRates = !stated("storage_rate");
  const [form, other] = twoRates ? [TWO_RATES, ONE_RATE] : [ONE_RATE, TWO_RATES];
  if (!form.some(([key]) => stated(key)))
    throw new Error("A monthly storage row states no storage rate");
  if (other.some(([key]) => stated(key)))
    throw new Error("A monthly storage row states its rate in both forms");
  const per = `${row.currency ?? ""} per ${VOLUME_UNITS[volumeUnit(row)]}`;
  const rates = form.map(
    ([key, label]): StorageEntry => [
      key,
      label,
      `${formatExactDecimal(storageFigure(row, key))} ${per}`,
    ],
  );
  if (!twoRates) {
    if ([UTILIZATION_RATIO, SURCHARGE_VOLUME, ...FEE_SPLIT.map(([key]) => key)].some(stated))
      throw new Error("A one-rate monthly storage row states a utilization surcharge");
    return rates;
  }
  return [
    [UTILIZATION_RATIO, "Storage utilization ratio", utilizationRatio(row)],
    ...rates,
    [SURCHARGE_VOLUME, "Estimated volume for surcharge", storageVolume(row, SURCHARGE_VOLUME)],
    ...FEE_SPLIT.map(
      ([key, label]): StorageEntry => [
        key,
        label,
        formatExactMoney(storageFigure(row, key), row.currency ?? null),
      ],
    ),
  ];
}

function checkStorageRow(row: CanonicalRow): void {
  storageFigure(row, "average_quantity_on_hand");
  if (!row.product_size_tier?.trim())
    throw new Error("A monthly storage row has no product size tier");
  storageVolume(row);
  storageFeeBasis(row);
}

/** Reject a report row the workspace cannot show truthfully, before any of it is shown. */
export function checkRawReportRow(dataset: RawReportKey, row: CanonicalRow): void {
  regionLabel(row.amazon_scope ?? "");
  if (dataset === "ad_invoices") {
    invoiceStatusLabel(row.invoice_status ?? "");
    return;
  }
  reportTaxLabel(row);
  if (dataset === "storage") checkStorageRow(row);
  if (dataset === "removal_orders") removalQuantityNote(row);
}
