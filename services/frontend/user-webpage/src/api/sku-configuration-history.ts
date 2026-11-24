import { parseExactCount } from "./content-range.ts";
import { validatePagination } from "./pagination.ts";
import { parseConfigurationPeriod } from "./sku-configuration-codec.ts";
import type { SkuConfigurationPeriod } from "./sku-configuration-types.ts";
import type { ApiTransport } from "./transport.ts";
import { isJsonObject, isUuid, requireUuid } from "./validation.ts";
import { parseRecordTimestamp } from "../date-display.ts";

export const SKU_CONFIGURATION_HISTORY_PAGE_SIZE = 10;

export interface SkuConfigurationVersion {
  id: string;
  key_id: string;
  company_id: string | null;
  version_number: number;
  memo: string;
  fee_period_count: number;
  created_at: string;
  periods: SkuConfigurationPeriod[];
}

export interface SkuConfigurationHistory {
  versions: SkuConfigurationVersion[];
  hasNext: boolean;
}

const OPERATION = "Saved fee versions";
function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.includes("\0"))
    throw new Error(`${OPERATION} returned an invalid ${key}`);
  return value;
}

function decodeVersion(row: unknown, skuId: string): SkuConfigurationVersion {
  if (!isJsonObject(row) || !Array.isArray(row.periods))
    throw new Error(`${OPERATION} returned an invalid version`);
  const id = requiredText(row, "id");
  requireUuid(id, "terms version");
  if (typeof row.key_id !== "string" || row.key_id.toLowerCase() !== skuId.toLowerCase())
    throw new Error(`${OPERATION} returned a different SKU`);
  if (row.company_id !== null && !isUuid(row.company_id))
    throw new Error("A valid company ID is required");
  const versionNumber = parseExactCount(row.version_number);
  const periodCount = parseExactCount(row.fee_period_count);
  const createdAt = requiredText(row, "created_at");
  if (versionNumber < 1 || !parseRecordTimestamp(createdAt))
    throw new Error(`${OPERATION} returned invalid version metadata`);
  const periods = row.periods.map(parseConfigurationPeriod);
  if (
    periods.length !== periodCount ||
    new Set(periods.map((p) => JSON.stringify([p.marketplace_name, p.valid_from]))).size !==
      periods.length
  )
    throw new Error(`${OPERATION} returned an invalid period inventory`);
  return {
    id,
    key_id: row.key_id,
    company_id: row.company_id,
    version_number: versionNumber,
    memo: requiredText(row, "memo"),
    fee_period_count: periodCount,
    created_at: createdAt,
    periods,
  };
}

export function createSkuConfigurationHistoryApi(transport: ApiTransport) {
  return {
    async fetchSkuConfigurationHistory(
      accessToken: string,
      skuId: string,
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<SkuConfigurationHistory> {
      requireUuid(skuId, "SKU");
      validatePagination(pageIndex, SKU_CONFIGURATION_HISTORY_PAGE_SIZE);
      const limit = SKU_CONFIGURATION_HISTORY_PAGE_SIZE;
      const offset = pageIndex * limit;
      if (!Number.isSafeInteger(offset + limit))
        throw new Error("Page offset exceeds JavaScript's safe range");
      signal?.throwIfAborted();
      const page = await transport.postRpc(
        accessToken,
        "sku_configuration_history",
        { p_key_id: skuId, p_offset: offset, p_limit: limit },
        OPERATION,
        signal,
      );
      signal?.throwIfAborted();
      if (
        !isJsonObject(page) ||
        !Array.isArray(page.versions) ||
        typeof page.has_next !== "boolean" ||
        page.versions.length > limit ||
        (page.has_next && page.versions.length !== limit)
      )
        throw new Error(`${OPERATION} returned an invalid page`);
      const versions = page.versions.map((row: unknown) => decodeVersion(row, skuId));
      if (
        new Set(versions.map((v) => v.id)).size !== versions.length ||
        versions.some((v, i) => i > 0 && v.version_number >= versions[i - 1].version_number)
      )
        throw new Error(`${OPERATION} returned invalid version ordering`);
      return { versions, hasNext: page.has_next };
    },
  };
}
