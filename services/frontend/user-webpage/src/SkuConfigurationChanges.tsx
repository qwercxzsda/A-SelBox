import { Badge, Group, Stack, Text } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { formatExactDecimal } from "./decimal";
import { isFeeRate } from "./api/sku-configuration-codec";
import { feePeriodChanges } from "./sku-configuration-changes";
import { companyLabel } from "./view-model";

function rateLabel(rate: string) {
  return isFeeRate(rate) ? `${formatExactDecimal(rate)}%` : rate || "Not set";
}

export function SkuConfigurationChanges({
  draft,
  saved,
  companies,
}: {
  draft: SkuConfigurationChange;
  saved: SkuConfigurationItem | undefined;
  companies: Map<string, string>;
}) {
  const periods = feePeriodChanges(saved?.periods ?? [], draft.periods);
  const companyChanged = (saved?.company_id ?? null) !== draft.company_id;
  return (
    <Stack gap="xs" mt="sm" role="region" aria-label={`Changes for ${draft.sku}`}>
      {!saved ? <Badge variant="light">New SKU</Badge> : null}
      {companyChanged ? (
        <Text size="sm">
          Company: {companyLabel(saved?.company_id ?? null, companies)} →{" "}
          {companyLabel(draft.company_id, companies)}
        </Text>
      ) : null}
      {periods.map(({ kind, period, previousRate }, index) => (
        <Group gap="xs" align="start" wrap="nowrap" key={index}>
          <Badge
            variant="light"
            color={kind === "removed" ? "red" : kind === "added" ? "#386515" : "blue"}
            style={{ flexShrink: 0 }}
          >
            {kind === "rate"
              ? "Rate changed"
              : kind === "added"
                ? "Period added"
                : "Period removed"}
          </Badge>
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <Text size="sm">
              {period.marketplace_name || "Marketplace not set"} ·{" "}
              {previousRate !== undefined ? `${rateLabel(previousRate)} → ` : ""}
              {rateLabel(period.fee_rate_percent)}
            </Text>
            <Text size="xs" c="dimmed">
              {period.valid_from || "Start not set"} (inclusive) →{" "}
              {period.valid_to ? `${period.valid_to} (exclusive)` : "No end date"}
            </Text>
          </div>
        </Group>
      ))}
      {saved && !companyChanged && periods.length === 0 ? (
        <Text size="sm" c="dimmed">
          No changes to the saved company or fee periods.
        </Text>
      ) : null}
    </Stack>
  );
}
