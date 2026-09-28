import marketplaces from "../generated/marketplaces.json" with { type: "json" };
import { requireCalendarDate } from "./filters.ts";
import { isJsonObject, requiredJsonString } from "./validation.ts";
import type {
  SkuConfiguration,
  SkuConfigurationIssue,
  SkuConfigurationPeriod,
  SkuConfigurationRequirement,
} from "./sku-configuration-types.ts";

const MARKETPLACES = new Set<string>(marketplaces);

export function isFeeRate(value: string): boolean {
  return /^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(value) && Number(value) <= 100;
}

export function requireExactSku(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error("A nonblank SKU is required");
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw new Error("SKU configuration returned invalid data");
  return value;
}

function nullableId(value: unknown): string | null {
  if (value === null || (typeof value === "string" && value.trim() && !value.includes("\0")))
    return value;
  throw new Error("SKU configuration returned an invalid identifier");
}

function marketplace(value: Record<string, unknown>): string {
  const name = requiredJsonString(value, "marketplace_name");
  if (!MARKETPLACES.has(name)) throw new Error("SKU configuration returned an invalid marketplace");
  return name;
}

function dateRange(value: Record<string, unknown>): {
  valid_from: string;
  valid_to: string | null;
} {
  const from = requiredJsonString(value, "valid_from");
  const to = value.valid_to === null ? null : requiredJsonString(value, "valid_to");
  requireCalendarDate(from);
  if (to !== null) {
    requireCalendarDate(to);
    if (to <= from) throw new Error("A fee period must end after it starts");
  }
  return { valid_from: from, valid_to: to };
}

export function parseConfigurationPeriod(value: unknown): SkuConfigurationPeriod {
  const row = requireObject(value);
  const rate = requiredJsonString(row, "fee_rate_percent");
  if (!isFeeRate(rate)) throw new Error("Fee rates must be 0–100 with at most six decimal places");
  return { marketplace_name: marketplace(row), ...dateRange(row), fee_rate_percent: rate };
}

function parseRequirement(value: unknown): SkuConfigurationRequirement {
  const row = requireObject(value);
  const dates = dateRange(row);
  if (dates.valid_to === null) throw new Error("SKU configuration returned an invalid requirement");
  return { marketplace_name: marketplace(row), ...dates, valid_to: dates.valid_to };
}

export function parseConfigurationIssues(value: unknown): SkuConfigurationIssue[] {
  if (!Array.isArray(value)) throw new Error("SKU configuration returned invalid issues");
  return value.map((entry: unknown) => {
    const row = requireObject(entry);
    requireExactSku(row.sku);
    if (row.kind === "missing_company") {
      if (row.marketplace_name !== null || row.valid_from !== null || row.valid_to !== null)
        throw new Error("SKU configuration returned an invalid company issue");
      return {
        sku: row.sku,
        kind: "missing_company",
        marketplace_name: null,
        valid_from: null,
        valid_to: null,
      };
    }
    if (row.kind !== "missing_fee") throw new Error("SKU configuration returned an invalid issue");
    return { sku: row.sku, kind: "missing_fee", ...parseRequirement(row) };
  });
}

export function parseSkuConfiguration(value: unknown): SkuConfiguration {
  const result = requireObject(value);
  if (!Array.isArray(result.items)) throw new Error("SKU configuration returned invalid items");
  const seen = new Set<string>();
  return {
    items: result.items.map((entry: unknown) => {
      const row = requireObject(entry);
      requireExactSku(row.sku);
      if (seen.has(row.sku)) throw new Error("SKU configuration returned a duplicate SKU");
      seen.add(row.sku);
      if (!Array.isArray(row.periods) || !Array.isArray(row.requirements))
        throw new Error("SKU configuration returned invalid fee coverage");
      const skuId = nullableId(row.sku_id);
      const version = nullableId(row.terms_version_id);
      const company = nullableId(row.company_id);
      if ((skuId === null && version !== null) || (company !== null && version === null))
        throw new Error("SKU configuration returned inconsistent ownership");
      const issues = parseConfigurationIssues(row.issues);
      if (issues.some((issue) => issue.sku !== row.sku))
        throw new Error("SKU configuration returned mismatched issues");
      return {
        sku: row.sku,
        sku_id: skuId,
        company_id: company,
        terms_version_id: version,
        periods: row.periods.map(parseConfigurationPeriod),
        requirements: row.requirements.map(parseRequirement),
        issues,
      };
    }),
  };
}
