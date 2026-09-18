const LABELS: Record<string, string> = {
  SETTLEMENT: "Settlements",
  DATA_KIOSK: "Data Kiosk",
  SELBOX: "Account-level",
  ANALYSIS_ONLY: "Analysis only",
  APPLIED: "Fee applied",
  NOT_APPLICABLE: "Fee not applicable",
  MISSING_FEE: "Fee rate missing",
  MISSING_OWNERSHIP: "Company assignment missing",
  operator: "Administrator",
  company_member: "Company member",
  preprocess_version: "Processing version",
};

export function humanizeCode(value: string): string {
  return LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export function categoryLabel(value: string): string {
  return humanizeCode(value);
}
