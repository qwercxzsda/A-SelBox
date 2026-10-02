import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Divider,
  Drawer,
  Group,
  NativeSelect,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  Company,
  SkuConfigurationChange,
  SkuConfigurationItem,
  SkuConfigurationPeriod,
} from "./api";
import { SkuFeePeriodEditor } from "./SkuFeePeriodEditor";
import { createSkuDraft, validateSkuItem } from "./sku-configuration-form";
import type { FeeEditorState } from "./workspace-view-state";
import "./SkuConfigurationDrawer.css";

export function SkuConfigurationEditor({
  item,
  editing,
  onEditingChange,
  companies,
  knownSkus,
  isNew,
  onClose,
  onStage,
  onEditExisting,
}: {
  item: SkuConfigurationItem;
  editing: FeeEditorState;
  onEditingChange: Dispatch<SetStateAction<FeeEditorState>>;
  companies: Company[];
  knownSkus: string[];
  isNew: boolean;
  onClose: () => void;
  onStage: (change: SkuConfigurationChange) => void;
  onEditExisting: (sku: string) => void;
}) {
  const { form, submitError } = editing;
  const marketplaceInputs = useRef(new Map<number, HTMLSelectElement>());
  const addPeriodButton = useRef<HTMLButtonElement>(null);
  const periodFocus = useRef<number | "add" | null>(null);
  useEffect(() => {
    if (periodFocus.current === null) return;
    const target =
      periodFocus.current === "add"
        ? addPeriodButton.current
        : marketplaceInputs.current.get(periodFocus.current);
    target?.focus();
    periodFocus.current = null;
  }, [form.periods.length]);
  const setForm = (update: SetStateAction<SkuConfigurationChange>) => {
    onEditingChange((current) => ({
      ...current,
      form: typeof update === "function" ? update(current.form) : update,
    }));
  };
  const setSubmitError = (submitError: string | null) => {
    onEditingChange((current) => ({ ...current, submitError }));
  };
  const issues = validateSkuItem({ ...item, ...form });
  const stale = form.expected_current_version_id !== item.terms_version_id;
  const existingSku = isNew && knownSkus.includes(form.sku);
  function updatePeriod(index: number, field: keyof SkuConfigurationPeriod, value: string | null) {
    setForm((current) => ({
      ...current,
      periods: current.periods.map((period, position) =>
        position === index ? { ...period, [field]: value } : period,
      ),
    }));
  }
  function addPeriod() {
    periodFocus.current = form.periods.length;
    setForm({
      ...form,
      periods: [
        ...form.periods,
        { marketplace_name: "", valid_from: "", valid_to: null, fee_rate_percent: "" },
      ],
    });
  }
  function removePeriod(index: number) {
    if (index === form.periods.length - 1) periodFocus.current = index === 0 ? "add" : index - 1;
    setForm((current) => ({
      ...current,
      periods: current.periods.filter((_, position) => position !== index),
    }));
  }
  return (
    <Drawer
      opened
      onClose={onClose}
      title={isNew ? "Add SKU" : `Edit ${item.sku}`}
      position="right"
      size={960}
      classNames={{
        content: "sku-configuration-drawer-content",
        body: "sku-configuration-drawer-body",
        title: "sku-configuration-drawer-title",
      }}
      closeButtonProps={{ "aria-label": "Close SKU editor" }}
    >
      <form
        className="sku-configuration-drawer-layout"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.sku.trim() || form.sku.includes("\0")) {
            setSubmitError("Enter a SKU.");
            return;
          }
          if (existingSku) {
            setSubmitError("This exact SKU already exists. Edit its current settings instead.");
            return;
          }
          onStage(form);
        }}
      >
        <Stack gap="md" className="sku-configuration-drawer-scroll">
          <Text size="sm" c="dimmed">
            Changes stay in a draft until you review and save all changes.
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
            <Autocomplete
              label="SKU"
              description="Type a SKU prefix to find existing settings, or enter a new exact SKU. Spelling and spaces are preserved."
              value={form.sku}
              data={
                form.sku
                  ? knownSkus
                      .filter((sku) => sku.toLowerCase().startsWith(form.sku.toLowerCase()))
                      .slice(0, 20)
                  : []
              }
              filter={({ options }) => options}
              onChange={(sku) => {
                setSubmitError(null);
                setForm({ ...form, sku });
              }}
              error={submitError}
              data-autofocus
            />
          ) : null}
          {existingSku ? (
            <Alert color="blue" title="This SKU already has settings">
              <Text size="sm">Open its settings to continue editing any existing draft.</Text>
              <Button
                mt="sm"
                variant="light"
                onClick={() => {
                  onEditExisting(form.sku);
                }}
              >
                Edit existing SKU
              </Button>
            </Alert>
          ) : null}
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
          <Stack gap={4}>
            <Title order={4} className="sku-configuration-section-title">
              Marketplace fee periods
            </Title>
            <Text size="sm" c="dimmed">
              Start dates are inclusive. End dates are exclusive; leave an end date blank for an
              ongoing rate. Enter 0 only when the agreed fee is zero.
            </Text>
          </Stack>
          {form.periods.length === 0 ? (
            <Text size="sm">
              No fee periods. Add a period when this SKU has transactions that require a fee.
            </Text>
          ) : null}
          {form.periods.map((period, index) => (
            <SkuFeePeriodEditor
              key={index}
              period={period}
              index={index}
              issues={issues}
              marketplaceRef={(element) => {
                if (element) marketplaceInputs.current.set(index, element);
                else marketplaceInputs.current.delete(index);
              }}
              onUpdate={(field, value) => {
                updatePeriod(index, field, value);
              }}
              onRemove={() => {
                removePeriod(index);
              }}
            />
          ))}
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
        </Stack>
        <Stack gap="xs" className="sku-configuration-drawer-actions">
          <Text size="xs" c="dimmed">
            You can keep an unfinished draft and complete it before saving.
          </Text>
          <Group justify="space-between">
            <Button
              ref={addPeriodButton}
              variant="light"
              onClick={addPeriod}
              disabled={existingSku}
            >
              Add fee period
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={existingSku}>
                Keep draft
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
