import type { Ref } from "react";
import { Button, Group, NativeSelect, Paper, Stack, Text, TextInput } from "@mantine/core";
import type { SkuConfigurationPeriod } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import marketplaces from "./generated/marketplaces.json";

export function SkuFeePeriodEditor({
  period,
  index,
  issues,
  marketplaceRef,
  onUpdate,
  onRemove,
}: {
  period: SkuConfigurationPeriod;
  index: number;
  issues: SkuFormIssue[];
  marketplaceRef: Ref<HTMLSelectElement>;
  onUpdate: (field: keyof SkuConfigurationPeriod, value: string | null) => void;
  onRemove: () => void;
}) {
  const number = String(index + 1);
  const errorFor = (field: keyof SkuConfigurationPeriod) =>
    issues.find((issue) => issue.periodIndex === index && issue.field === field)?.message;
  return (
    <Paper withBorder p="sm" className="sku-configuration-card">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Period {number}
          </Text>
          <Button
            size="compact-sm"
            color="#9e1834"
            variant="subtle"
            aria-label={`Remove period ${number}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </Group>
        <div className="sku-fee-period-fields">
          <NativeSelect
            ref={marketplaceRef}
            label={`Marketplace ${number}`}
            value={period.marketplace_name}
            data={[{ value: "", label: "Choose a marketplace" }, ...marketplaces]}
            onChange={(event) => {
              onUpdate("marketplace_name", event.currentTarget.value);
            }}
            error={errorFor("marketplace_name")}
          />
          <TextInput
            label={`Fee rate ${number} (%)`}
            inputMode="decimal"
            value={period.fee_rate_percent}
            onChange={(event) => {
              onUpdate("fee_rate_percent", event.currentTarget.value);
            }}
            error={errorFor("fee_rate_percent")}
          />
          <TextInput
            label={`Start date ${number} (inclusive)`}
            type="date"
            value={period.valid_from}
            onChange={(event) => {
              onUpdate("valid_from", event.currentTarget.value);
            }}
            error={errorFor("valid_from")}
          />
          <TextInput
            label={`End date ${number} (exclusive)`}
            type="date"
            value={period.valid_to ?? ""}
            onChange={(event) => {
              onUpdate("valid_to", event.currentTarget.value || null);
            }}
            error={errorFor("valid_to")}
          />
        </div>
      </Stack>
    </Paper>
  );
}
