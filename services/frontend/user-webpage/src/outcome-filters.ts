import { OUTCOMES, type Outcome } from "./api/allocations.ts";
import { isJsonObject } from "./api/validation.ts";
import marketplaces from "./generated/marketplaces.json" with { type: "json" };
export function decodeOutcomeFilters(value: unknown) {
  const data = isJsonObject(value) ? value : {};
  const view: Outcome | "MONTHS" =
    data.view === "MONTHS" ? "MONTHS" : (OUTCOMES.find((key) => key === data.view) ?? "DIFFERENCE");
  const month =
    typeof data.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) ? data.month : "";
  const marketplace = marketplaces.find((key) => key === data.marketplace) ?? "";
  return { view, month, marketplace };
}
