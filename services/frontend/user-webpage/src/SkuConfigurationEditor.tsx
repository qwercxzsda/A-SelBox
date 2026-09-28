import { useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Group,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type {
  Company,
  SkuConfigurationChange,
  SkuConfigurationItem,
  SkuConfigurationPeriod,
} from "./api";
import marketplaces from "./generated/marketplaces.json";
import { createSkuDraft, validateSkuItem } from "./sku-configuration-form";

export function SkuConfigurationEditor({
  item,
  draft,
  companies,
  knownSkus,
  isNew,
  onClose,
  onStage,
}: {
  item: SkuConfigurationItem;
  draft?: SkuConfigurationChange;
  companies: Company[];
  knownSkus: string[];
  isNew: boolean;
  onClose: () => void;
  onStage: (change: SkuConfigurationChange) => void;
}) {
  const [form, setForm] = useState<SkuConfigurationChange>(() =>
    structuredClone(draft ?? createSkuDraft(item)),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const issues = validateSkuItem({ ...item, ...form });
  const stale = form.expected_current_version_id !== item.terms_version_id;
  function updatePeriod(index: number, field: keyof SkuConfigurationPeriod, value: string | null) {
    setForm((current) => ({
      ...current,
      periods: current.periods.map((period, position) =>
        position === index ? { ...period, [field]: value } : period,
      ),
    }));
  }
  const errorFor = (index: number, field: keyof SkuConfigurationPeriod) =>
    issues.find((issue) => issue.periodIndex === index && issue.field === field)?.message;
  return (
    <Drawer
      opened
      onClose={onClose}
      title={isNew ? "Add SKU" : `Edit ${item.sku}`}
      position="right"
      size="xl"
      closeButtonProps={{ "aria-label": "Close SKU editor" }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.sku.trim() || form.sku.includes("\0")) {
            setSubmitError("Enter a SKU.");
            return;
          }
          if (isNew && knownSkus.includes(form.sku)) {
            setSubmitError("This exact SKU already exists. Edit its current settings instead.");
            return;
          }
          onStage(form);
        }}
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            Changes stay in a draft until you review and save all changes. Every known SKU needs a
            company and fee coverage for its applicable transactions.
          </Text>
          {stale ? (
            <Alert color="orange" role="alert">
              Saved settings changed while this draft was being edited. Your draft has been kept.
              <Button
                mt="sm"
                variant="light"
                onClick={() => {
                  setForm(createSkuDraft(item));
                }}
              >
                Load latest saved settings
              </Button>
            </Alert>
          ) : null}
          {isNew ? (
            <TextInput
              label="SKU"
              description="Use the exact SKU, including its spelling and spaces."
              value={form.sku}
              onChange={(event) => {
                setSubmitError(null);
                setForm({ ...form, sku: event.currentTarget.value });
              }}
              error={submitError}
              data-autofocus
            />
          ) : (
            <Title order={3}>{item.sku}</Title>
          )}
          <NativeSelect
            label="Company"
            value={form.company_id ?? ""}
            data={[
              { value: "", label: "Choose a company" },
              ...companies.map((company) => ({ value: company.id, label: company.name })),
            ]}
            onChange={(event) => {
              setForm({ ...form, company_id: event.currentTarget.value || null });
            }}
            error={!form.company_id ? "A company is required before saving." : undefined}
          />
          <Divider />
          <Stack gap="xs">
            <Title order={4}>Marketplace fee periods</Title>
            <Text size="sm" c="dimmed">
              Start dates are included. End dates are not included; leave an end date blank for an
              ongoing rate. Enter 0 only when the agreed fee is zero.
            </Text>
          </Stack>
          {form.periods.length === 0 ? (
            <Text size="sm">
              No fee periods. Add a period when this SKU has transactions that require a fee.
            </Text>
          ) : null}
          {form.periods.map((period, index) => (
            <Paper withBorder p="md" key={index}>
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>Period {index + 1}</Text>
                  <Button
                    size="compact-sm"
                    color="red"
                    variant="subtle"
                    aria-label={`Remove period ${String(index + 1)}`}
                    onClick={() => {
                      setForm({
                        ...form,
                        periods: form.periods.filter((_, position) => position !== index),
                      });
                    }}
                  >
                    Remove
                  </Button>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NativeSelect
                    label={`Marketplace ${String(index + 1)}`}
                    value={period.marketplace_name}
                    data={[{ value: "", label: "Choose a marketplace" }, ...marketplaces]}
                    onChange={(event) => {
                      updatePeriod(index, "marketplace_name", event.currentTarget.value);
                    }}
                    error={errorFor(index, "marketplace_name")}
                  />
                  <TextInput
                    label={`Fee rate ${String(index + 1)} (%)`}
                    inputMode="decimal"
                    value={period.fee_rate_percent}
                    onChange={(event) => {
                      updatePeriod(index, "fee_rate_percent", event.currentTarget.value);
                    }}
                    error={errorFor(index, "fee_rate_percent")}
                  />
                  <TextInput
                    label={`Start date ${String(index + 1)}`}
                    type="date"
                    value={period.valid_from}
                    onChange={(event) => {
                      updatePeriod(index, "valid_from", event.currentTarget.value);
                    }}
                    error={errorFor(index, "valid_from")}
                  />
                  <TextInput
                    label={`End date ${String(index + 1)} (not included)`}
                    type="date"
                    value={period.valid_to ?? ""}
                    onChange={(event) => {
                      updatePeriod(index, "valid_to", event.currentTarget.value || null);
                    }}
                    error={errorFor(index, "valid_to")}
                  />
                </SimpleGrid>
              </Stack>
            </Paper>
          ))}
          <Button
            variant="light"
            onClick={() => {
              setForm({
                ...form,
                periods: [
                  ...form.periods,
                  { marketplace_name: "", valid_from: "", valid_to: null, fee_rate_percent: "" },
                ],
              });
            }}
          >
            Add fee period
          </Button>
          {issues.some((issue) => !issue.field) ? (
            <Alert color="orange" title="Fee coverage still needed">
              <Stack gap={4}>
                {issues
                  .filter((issue) => !issue.field)
                  .map((issue, index) => (
                    <Text size="sm" key={index}>
                      {issue.message}
                    </Text>
                  ))}
              </Stack>
            </Alert>
          ) : null}
          <Text size="sm" c="dimmed">
            You can keep an unfinished draft and complete it before saving.
          </Text>
          <Group justify="space-between">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Keep draft</Button>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
