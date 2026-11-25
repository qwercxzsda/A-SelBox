import { useEffect, useRef } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import type { SkuConfigurationPeriod } from "./api";
import { planFeeRateChange, type FeeRateChangeDraft } from "./sku-rate-change";
import { SkuFeePeriods } from "./SkuFeePeriods";
import { RATE_CHANGE_FROM_LABEL } from "./fee-period-labels";

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
  const rateInput = useRef<HTMLInputElement>(null);
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
        <Title order={4} size="h5">
          Change rate from date
        </Title>
        <Text size="sm" c="dimmed">
          {periods[draft.periodIndex].marketplace_name}
        </Text>
        <div className="sku-rate-change-fields">
          <TextInput
            ref={dateInput}
            data-autofocus
            label={RATE_CHANGE_FROM_LABEL}
            type="date"
            value={draft.effectiveDate}
            onChange={(event) => {
              update({ effectiveDate: event.currentTarget.value });
            }}
            error={draft.previewRequested ? errors.effectiveDate : undefined}
          />
          <TextInput
            ref={rateInput}
            label="New fee rate (%)"
            inputMode="decimal"
            value={draft.feeRatePercent}
            onChange={(event) => {
              update({ feeRatePercent: event.currentTarget.value });
            }}
            error={draft.previewRequested ? errors.feeRatePercent : undefined}
          />
        </div>
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
                if (errors.effectiveDate) dateInput.current?.focus();
                else if (errors.feeRatePercent) rateInput.current?.focus();
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
