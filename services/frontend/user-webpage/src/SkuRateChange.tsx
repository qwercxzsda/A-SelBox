import { useEffect, useRef } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import type { SkuConfigurationPeriod } from "./api";
import { planFeeRateChange, type FeeRateChangeDraft } from "./sku-rate-change";
import { SkuFeePeriods } from "./SkuFeePeriods";

export function SkuRateChange({
  sku,
  periods,
  draft,
  onChange,
  onApply,
  onCancel,
}: {
  sku: string;
  periods: SkuConfigurationPeriod[];
  draft: FeeRateChangeDraft;
  onChange: (draft: FeeRateChangeDraft) => void;
  onApply: (periods: SkuConfigurationPeriod[]) => void;
  onCancel: () => void;
}) {
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dateInput.current?.focus();
  }, []);
  const { errors, plan } = planFeeRateChange(periods, draft);
  const update = (patch: Partial<FeeRateChangeDraft>) => {
    onChange({ ...draft, ...patch, previewRequested: false });
  };
  return (
    <Paper
      withBorder
      p="md"
      className="sku-rate-change"
      component="section"
      aria-label="Change rate from date"
    >
      <Stack gap="sm">
        <Title order={5}>Change rate from date</Title>
        <Text size="sm" c="dimmed">
          {periods[draft.periodIndex].marketplace_name}. Preview the date boundary before adding it
          to your draft. Other periods stay unchanged.
        </Text>
        <Group align="start" grow>
          <TextInput
            ref={dateInput}
            data-autofocus
            label="New rate effective date"
            type="date"
            value={draft.effectiveDate}
            onChange={(event) => {
              update({ effectiveDate: event.currentTarget.value });
            }}
            error={draft.previewRequested ? errors.effectiveDate : undefined}
          />
          <TextInput
            label="New fee rate (%)"
            inputMode="decimal"
            value={draft.feeRatePercent}
            onChange={(event) => {
              update({ feeRatePercent: event.currentTarget.value });
            }}
            error={draft.previewRequested ? errors.feeRatePercent : undefined}
          />
        </Group>
        {draft.previewRequested && errors.period ? (
          <Alert color="red" role="alert">
            {errors.period}
          </Alert>
        ) : null}
        {draft.previewRequested && plan ? (
          <>
            <Text fw={600} size="sm">
              Proposed periods
            </Text>
            <SkuFeePeriods item={{ sku, periods: plan.replacement }} />
            <Text size="sm">
              {plan.replacement.length === 2
                ? "The previous rate ends exclusively on the new rate's inclusive start date."
                : "The new rate replaces this period from its existing start date."}{" "}
              Nothing is saved yet.
            </Text>
          </>
        ) : null}
        <Group justify="space-between">
          <Button type="button" variant="default" onClick={onCancel}>
            Cancel rate change
          </Button>
          {draft.previewRequested && plan ? (
            <Button
              type="button"
              onClick={() => {
                onApply(plan.periods);
              }}
            >
              Use rate change in draft
            </Button>
          ) : (
            <Button
              type="button"
              variant="light"
              onClick={() => {
                onChange({ ...draft, previewRequested: true });
              }}
            >
              Preview rate change
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
