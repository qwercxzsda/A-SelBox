/**
 * Amazon codes known beforehand, with the words the workspace shows for them. A code outside these
 * lists is an error, never shown as it came.
 */

type Labels = Readonly<Record<string, string>>;

function knownLabel(labels: Labels, code: string, kind: string): string {
  const label = Object.hasOwn(labels, code) ? labels[code] : undefined;
  if (label === undefined) throw new Error(`Unknown ${kind} ${code}`);
  return label;
}

/** Amazon's regional seller accounts (`amazon_scope`). */
const REGIONS: Labels = {
  NA: "North America",
  EU: "Europe",
  JAPAN: "Japan",
  SINGAPORE: "Singapore",
  AUSTRALIA: "Australia",
};

/** Advertising invoice statuses observed in Amazon Ads invoices; preprocessing accepts no other. */
const INVOICE_STATUSES: Labels = { PAID_IN_FULL: "Paid in full" };

/** Amazon Ads programs as Amazon writes them. */
const AD_PROGRAMS: Labels = {
  SPONSORED_PRODUCTS: "Sponsored Products",
  SPONSORED_BRANDS: "Sponsored Brands",
  SPONSORED_DISPLAY: "Sponsored Display",
  SPONSORED_TV: "Sponsored TV",
};

/** Advertising invoice lines: campaign costs, then Amazon's adjustments. */
const INVOICE_LINE_KINDS: Labels = {
  CAMPAIGN: "Campaign",
  ACCOUNT_ADJUSTMENT: "Account adjustment",
  CAMPAIGN_ADJUSTMENT: "Campaign adjustment",
};

const INVOICE_ADJUSTMENT_KINDS: Labels = {
  OVER_DELIVERY_CLICK_CREDITS: "Over delivery click credits",
  ROUNDING: "Rounding",
  OVER_DELIVERY_AGAINST_CAMPAIGN: "Over delivery against campaign",
};

export const regionLabel = (code: string) => knownLabel(REGIONS, code, "Amazon region");

export const invoiceStatusLabel = (code: string) =>
  knownLabel(INVOICE_STATUSES, code, "advertising invoice status");

export const adProgramLabel = (code: string) => knownLabel(AD_PROGRAMS, code, "ad program");

/** "Campaign", or the adjustment with its kind: "Account adjustment · Rounding". */
export function invoiceLineKindLabel(lineKind: string, adjustmentKind: string | null): string {
  const kind = knownLabel(INVOICE_LINE_KINDS, lineKind, "invoice line kind");
  if (lineKind === "CAMPAIGN") {
    if (adjustmentKind !== null) throw new Error("A campaign line has no adjustment kind");
    return kind;
  }
  if (adjustmentKind === null) throw new Error(`An invoice ${kind.toLowerCase()} has no kind`);
  return `${kind} · ${knownLabel(INVOICE_ADJUSTMENT_KINDS, adjustmentKind, "invoice adjustment")}`;
}
