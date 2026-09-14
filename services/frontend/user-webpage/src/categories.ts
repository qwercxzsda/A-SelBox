const LABELS: Record<string, string> = {
  SETTLEMENT: "Settlement",
  DATA_KIOSK: "Data Kiosk",
  SELBOX: "Account-level",
  ANALYSIS_ONLY: "Analysis only",
  APPLIED: "Fee applied",
  NOT_APPLICABLE: "No commission",
  MISSING_FEE: "Missing fee",
  MISSING_OWNERSHIP: "Unassigned SKU",
  operator: "Operator",
  company_member: "Company member",
};

export function humanizeCode(value: string): string {
  return LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export function categoryLabel(value: string): string {
  return humanizeCode(value);
}
