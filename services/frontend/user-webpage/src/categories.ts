const LABELS: Record<string, string> = {
  SETTLEMENT: "Settlements",
  DATA_KIOSK: "Data Kiosk",
  SELBOX: "SelBox",
  RECONCILIATION: "Reconciliation",
  ANALYSIS_ONLY: "Analysis only",
  APPLIED: "Fee applied",
  NOT_APPLICABLE: "Fee not applicable",
  MISSING_FEE: "Fee rate missing",
  MISSING_OWNERSHIP: "Company assignment missing",
  operator: "Administrator",
  company_member: "Company member",
  preprocess_version: "Processing version",
};

const TYPE_ACRONYMS = new Set([
  "FBA",
  "VAT",
  "GST",
  "HST",
  "PST",
  "QST",
  "TCS",
  "TDS",
  "SKU",
  "ASIN",
  "COD",
  "MFN",
  "SOA",
  "EPR",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "MXN",
  "INR",
  "BRL",
]);
const TYPE_COUNTRY_CODES = new Set(["GB", "BE", "DE", "ES", "FR", "IT", "NL"]);
const TYPE_WORDS = new Map([
  ["amazon", "Amazon"],
  ["vine", "Vine"],
  ["fulfilment", "fulfillment"],
]);

export function allocationCategoryLabel(value: string): string {
  return value === "SETTLEMENT" ? "Settlement" : humanizeCode(value);
}

/** Display source type codes consistently without changing their filter/group identity. */
export function transactionTypeLabel(value: string): string {
  if (value === "SETTLEMENT_KIOSK_DIFFERENCE") return "Settlement / Data Kiosk difference";
  return value
    .split("/")
    .map((segment) => {
      const words = segment
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z\d])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .split(/\s+/);
      return words
        .map((word, index) => {
          const acronym = word.toUpperCase();
          if (TYPE_ACRONYMS.has(acronym) || TYPE_COUNTRY_CODES.has(word)) return acronym;
          const text = TYPE_WORDS.get(word.toLowerCase()) ?? word.toLowerCase();
          return index === 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
        })
        .join(" ");
    })
    .join(" · ");
}

export function humanizeCode(value: string): string {
  return LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}
