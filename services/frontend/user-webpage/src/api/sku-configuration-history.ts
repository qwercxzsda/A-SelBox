import { parseExactCount } from "./content-range.ts";
import { readAllCsvRows, validatePagination } from "./pagination.ts";
import { parseConfigurationPeriod } from "./sku-configuration-codec.ts";
import type { SkuConfigurationPeriod } from "./sku-configuration-types.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { requireUuid } from "./validation.ts";
import { parseRecordTimestamp } from "../date-display.ts";

export const SKU_CONFIGURATION_HISTORY_PAGE_SIZE = 10;

export interface SkuConfigurationVersion {
  id: string;
  sku_id: string;
  company_id: string | null;
  version_number: number;
  change_reason: string;
  fee_period_count: number;
  created_at: string;
  periods: SkuConfigurationPeriod[];
}

export interface SkuConfigurationHistory {
  versions: SkuConfigurationVersion[];
  hasNext: boolean;
}

const OPERATION = "Saved fee versions";
const VERSION_COLUMNS = [
  "id",
  "sku_id",
  "company_id",
  "version_number",
  "change_reason",
  "fee_period_count",
  "created_at",
];
const PERIOD_COLUMNS = [
  "id",
  "terms_version_id",
  "marketplace_name",
  "valid_period",
  "fee_rate_percent",
];

function requiredText(row: CanonicalRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.includes("\0"))
    throw new Error(`${OPERATION} returned an invalid ${key}`);
  return value;
}

function decodeVersion(row: CanonicalRow, skuId: string): SkuConfigurationVersion {
  const id = requiredText(row, "id");
  requireUuid(id, "terms version");
  if (typeof row.sku_id !== "string" || row.sku_id.toLowerCase() !== skuId.toLowerCase())
    throw new Error(`${OPERATION} returned a different SKU`);
  if (row.company_id !== null) requireUuid(row.company_id, "company");
  const versionNumber = parseExactCount(row.version_number);
  const periodCount = parseExactCount(row.fee_period_count);
  const createdAt = requiredText(row, "created_at");
  if (versionNumber < 1 || !parseRecordTimestamp(createdAt))
    throw new Error(`${OPERATION} returned invalid version metadata`);
  return {
    id,
    sku_id: row.sku_id,
    company_id: row.company_id,
    version_number: versionNumber,
    change_reason: requiredText(row, "change_reason"),
    fee_period_count: periodCount,
    created_at: createdAt,
    periods: [],
  };
}

function decodePeriod(row: CanonicalRow, versionIds: ReadonlySet<string>) {
  const id = requiredText(row, "id");
  requireUuid(id, "fee period");
  const versionId = requiredText(row, "terms_version_id");
  if (!versionIds.has(versionId))
    throw new Error(`${OPERATION} returned a period from another version`);
  const range = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})?\)$/.exec(
    requiredText(row, "valid_period"),
  );
  if (!range) throw new Error(`${OPERATION} returned an invalid effective date range`);
  return {
    id,
    versionId,
    period: parseConfigurationPeriod({
      marketplace_name: row.marketplace_name,
      valid_from: range[1],
      valid_to: range[2] || null,
      fee_rate_percent: row.fee_rate_percent,
    }),
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
      const versions: SkuConfigurationVersion[] = [];
      const seen = new Set<string>();
      const pageOffset = pageIndex * SKU_CONFIGURATION_HISTORY_PAGE_SIZE;
      if (!Number.isSafeInteger(pageOffset + SKU_CONFIGURATION_HISTORY_PAGE_SIZE))
        throw new Error("Page offset exceeds JavaScript's safe range");
      // Fill the lookahead even when PostgREST applies a smaller server page cap.
      while (versions.length <= SKU_CONFIGURATION_HISTORY_PAGE_SIZE) {
        signal?.throwIfAborted();
        const limit = SKU_CONFIGURATION_HISTORY_PAGE_SIZE + 1 - versions.length;
        const result = await transport.readCsvPage(
          accessToken,
          "sku_terms_versions",
          new URLSearchParams({
            select: VERSION_COLUMNS.join(","),
            sku_id: `eq.${skuId}`,
            order: "version_number.desc,id.desc",
            limit: String(limit),
            offset: String(pageOffset + versions.length),
          }),
          OPERATION,
          signal,
          false,
        );
        signal?.throwIfAborted();
        if (result.rows.length === 0) break;
        if (result.rows.length > limit) throw new Error(`${OPERATION} returned too many versions`);
        for (const row of result.rows) {
          const version = decodeVersion(row, skuId);
          const previous = versions.at(-1);
          if (
            seen.has(version.id) ||
            (previous && version.version_number >= previous.version_number)
          )
            throw new Error(`${OPERATION} changed while loading. Please retry.`);
          seen.add(version.id);
          versions.push(version);
        }
      }
      const visible = versions.slice(0, SKU_CONFIGURATION_HISTORY_PAGE_SIZE);
      if (visible.length === 0) return { versions: [], hasNext: false };
      const versionIds = new Set(visible.map(({ id }) => id));
      const periods = await readAllCsvRows(transport, {
        accessToken,
        endpoint: "sku_fee_periods",
        columns: PERIOD_COLUMNS,
        filters: { terms_version_id: `in.(${[...versionIds].join(",")})` },
        order: "terms_version_id.asc,marketplace_name.asc,valid_period.asc,id.asc",
        operation: OPERATION,
        decode: (row) => decodePeriod(row, versionIds),
        identity: (row) => row.id,
        signal,
      });
      const byId = new Map(visible.map((version) => [version.id, version]));
      for (const { versionId, period } of periods) byId.get(versionId)?.periods.push(period);
      if (visible.some((version) => version.periods.length !== version.fee_period_count))
        throw new Error(`${OPERATION} returned incomplete fee periods. Please retry.`);
      return { versions: visible, hasNext: versions.length > SKU_CONFIGURATION_HISTORY_PAGE_SIZE };
    },
  };
}
