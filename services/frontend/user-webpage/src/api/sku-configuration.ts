import { ApiError, type ApiTransport } from "./transport.ts";
import { SkuConfigurationError } from "./sku-configuration-errors.ts";
import { isJsonObject, isUuid, requireUuid } from "./validation.ts";
import {
  parseConfigurationPeriod,
  parseSkuConfiguration,
  requireExactSku,
} from "./sku-configuration-codec.ts";
import type {
  PublishSkuConfigurationOptions,
  PublishSkuConfigurationResult,
  SkuConfiguration,
  SkuConfigurationChange,
} from "./sku-configuration-types.ts";

function validatedChanges(changes: SkuConfigurationChange[]): SkuConfigurationChange[] {
  if (!Array.isArray(changes) || changes.length === 0)
    throw new Error("Stage at least one SKU change before saving");
  const seen = new Set<string>();
  return changes.map((change) => {
    requireExactSku(change.sku);
    if (seen.has(change.sku)) throw new Error("Each SKU can be changed only once in a save");
    seen.add(change.sku);
    if (change.company_id !== null) requireUuid(change.company_id, "company");
    if (change.expected_current_version_id !== null)
      requireUuid(change.expected_current_version_id, "current terms version");
    if (!Array.isArray(change.periods)) throw new Error("Complete fee periods are required");
    return {
      sku: change.sku,
      company_id: change.company_id,
      expected_current_version_id: change.expected_current_version_id,
      periods: change.periods.map(parseConfigurationPeriod),
    };
  });
}

function parsePublished(
  value: unknown,
  changes: SkuConfigurationChange[],
): PublishSkuConfigurationResult {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value.published) ||
    value.changed_count !== changes.length ||
    value.published.length !== changes.length
  )
    throw new Error(
      "The save response was incomplete. Refresh the configuration before trying again.",
    );
  const expected = new Set(changes.map((change) => change.sku));
  const published = value.published.map((entry: unknown) => {
    if (
      !isJsonObject(entry) ||
      typeof entry.sku !== "string" ||
      !expected.delete(entry.sku) ||
      !isUuid(entry.terms_version_id)
    )
      throw new Error(
        "The save response was invalid. Refresh the configuration before trying again.",
      );
    return { sku: entry.sku, terms_version_id: entry.terms_version_id };
  });
  return { published, changed_count: published.length };
}

export function createSkuConfigurationApi(transport: ApiTransport) {
  return {
    async fetchSkuConfiguration(
      accessToken: string,
      signal?: AbortSignal,
    ): Promise<SkuConfiguration> {
      return parseSkuConfiguration(
        await transport.postRpc(
          accessToken,
          "sku_configuration",
          {},
          "Assignments and fees",
          signal,
        ),
      );
    },

    async publishSkuConfiguration(
      options: PublishSkuConfigurationOptions,
    ): Promise<PublishSkuConfigurationResult> {
      const changes = validatedChanges(options.changes);
      const note = options.changeReason?.trim() ?? "";
      const reason = note.length > 0 ? note : "Administrator updated assignments and fees";
      try {
        const result = await transport.postRpc(
          options.accessToken,
          "publish_sku_configuration",
          { p_changes: changes, p_change_reason: reason },
          "Save assignments and fees",
        );
        return parsePublished(result, changes);
      } catch (error) {
        if (
          error instanceof SkuConfigurationError ||
          (error instanceof ApiError && error.status !== null && error.status < 500)
        )
          throw error;
        throw new SkuConfigurationError(
          "unconfirmed",
          "We could not confirm the save. Reload the latest saved settings before saving again.",
        );
      }
    },
  };
}
