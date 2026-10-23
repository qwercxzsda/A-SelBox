import type { Ref } from "react";
import { Button, Group, NativeSelect, Paper, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { SkuConfigurationChange, SkuConfigurationPeriod } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import marketplaces from "./generated/marketplaces.json";

export function SkuFeePeriodEditor({
  form,
  index,
  issues,
  marketplaceRef,
  onRemove,
  onChangeRate,
  rateChangeOpen,
  initialFocusField,
}: {
  form: UseFormReturnType<SkuConfigurationChange>;
  index: number;
  issues: SkuFormIssue[];
  marketplaceRef: Ref<HTMLSelectElement>;
  onRemove: () => void;
  onChangeRate: () => void;
  rateChangeOpen: boolean;
  initialFocusField?: keyof SkuConfigurationPeriod;
}) {
  const period = form.values.periods[index];
  const path = (field: keyof SkuConfigurationPeriod) => `periods.${String(index)}.${field}`;
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
          <Group gap="xs">
            <Button
              type="button"
              size="compact-sm"
              variant="light"
              disabled={
                rateChangeOpen ||
                !period.marketplace_name ||
                !period.valid_from ||
                !period.fee_rate_percent
              }
              title={rateChangeOpen ? "Finish or cancel the current rate change first." : undefined}
              aria-label={`Change rate from date for period ${number}`}
              onClick={onChangeRate}
            >
              Change rate from date
            </Button>
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
        </Group>
        <div className="sku-fee-period-fields">
          <NativeSelect
            ref={marketplaceRef}
            data-autofocus={initialFocusField === "marketplace_name" || undefined}
            label={`Marketplace ${number}`}
            {...form.getInputProps(path("marketplace_name"), { withError: false })}
            data={[{ value: "", label: "Choose a marketplace" }, ...marketplaces]}
            error={errorFor("marketplace_name")}
          />
          <TextInput
            label={`Fee rate ${number} (%)`}
            data-autofocus={initialFocusField === "fee_rate_percent" || undefined}
            inputMode="decimal"
            {...form.getInputProps(path("fee_rate_percent"), { withError: false })}
            error={errorFor("fee_rate_percent")}
          />
          <TextInput
            label={`Start date ${number} (inclusive)`}
            data-autofocus={initialFocusField === "valid_from" || undefined}
            type="date"
            {...form.getInputProps(path("valid_from"), { withError: false })}
            error={errorFor("valid_from")}
          />
          <TextInput
            label={`End date ${number} (exclusive)`}
            data-autofocus={initialFocusField === "valid_to" || undefined}
            type="date"
            value={period.valid_to ?? ""}
            onChange={(event) => {
              form.setFieldValue(path("valid_to"), event.currentTarget.value || null);
            }}
            error={errorFor("valid_to")}
          />
        </div>
      </Stack>
    </Paper>
  );
}
