import {
  Fragment,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
  type SubmitEvent,
} from "react";
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
import type { Company, SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { SkuFeePeriodEditor } from "./SkuFeePeriodEditor";
import { createSkuDraft, validateSkuItem } from "./sku-configuration-form";
import type { FeeEditorState } from "./workspace-view-state";
import "./SkuConfigurationDrawer.css";
import { SkuRateChange } from "./SkuRateChange";
import { useSkuEditorForm } from "./use-sku-editor-form";

export function SkuConfigurationEditor({
  item,
  editing,
  onEditingChange,
  companies,
  knownSkus,
  onClose,
  onDiscard,
  onStage,
  onEditExisting,
  onAddCompany,
}: {
  item: SkuConfigurationItem;
  editing: FeeEditorState;
  onEditingChange: Dispatch<SetStateAction<FeeEditorState>>;
  companies: Company[];
  knownSkus: string[];
  onClose: () => void;
  onDiscard: () => void;
  onStage: (change: SkuConfigurationChange) => void;
  onEditExisting: (sku: string) => void;
  onAddCompany: () => void;
}) {
  const { form, replaceDraft, startRateChange, setRateChange, removePeriod } = useSkuEditorForm(
    editing,
    onEditingChange,
  );
  const values = form.values;
  const { isNew, submitError } = editing;
  const skuInput = useRef<HTMLInputElement>(null);
  const marketplaceInputs = useRef(new Map<number, HTMLSelectElement>());
  const addPeriodButton = useRef<HTMLButtonElement>(null);
  const pendingPeriodFocus = useRef<number | "add" | null>(null);
  useEffect(() => {
    if (pendingPeriodFocus.current === null) return;
    const target =
      pendingPeriodFocus.current === "add"
        ? addPeriodButton.current
        : marketplaceInputs.current.get(pendingPeriodFocus.current);
    target?.focus();
    pendingPeriodFocus.current = null;
  }, [values.periods.length]);
  function showSkuError(message: string) {
    onEditingChange((current) => ({ ...current, submitError: message }));
    skuInput.current?.focus();
    skuInput.current?.scrollIntoView({ block: "center" });
  }
  const knownCompanyIds = new Set(companies.map(({ id }) => id));
  const issues = validateSkuItem({ ...item, ...values }, knownCompanyIds);
  const coverageIssues = issues.filter((issue) => !issue.field);
  const initialIssue =
    editing.rateChange === null ? issues.find((issue) => issue.field) : undefined;
  const initialPeriodField =
    initialIssue?.field === "company_id" || initialIssue?.field === "sku"
      ? undefined
      : initialIssue?.field;
  const unavailableCompany = values.company_id !== null && !knownCompanyIds.has(values.company_id);
  const stale = values.expected_current_version_id !== item.terms_version_id;
  const existingSku = isNew && knownSkus.includes(values.sku);
  function stageDraft(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing.rateChange !== null) return;
    if (!values.sku.trim() || values.sku.includes("\0")) {
      showSkuError("Enter a SKU.");
      return;
    }
    if (existingSku) {
      showSkuError("This exact SKU already exists. Edit its current settings instead.");
      return;
    }
    onStage(form.getValues());
  }
  function addPeriod() {
    pendingPeriodFocus.current = values.periods.length;
    form.insertListItem("periods", {
      marketplace_name: "",
      valid_from: "",
      valid_to: null,
      fee_rate_percent: "",
    });
  }
  function handleRemovePeriod(index: number) {
    if (index === values.periods.length - 1)
      pendingPeriodFocus.current = index === 0 ? "add" : index - 1;
    removePeriod(index);
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
        onSubmit={stageDraft}
        onFocusCapture={(event) => {
          const target = event.target;
          if (
            target.hasAttribute("data-autofocus") &&
            target.getAttribute("aria-invalid") === "true"
          )
            requestAnimationFrame(() => {
              if (document.activeElement === target) target.scrollIntoView({ block: "center" });
            });
        }}
      >
        <Stack gap="md" className="sku-configuration-drawer-scroll">
          <Text size="sm" c="dimmed">
            Closing keeps unfinished edits here. Choose Keep draft when ready to review, then save
            all changes.
          </Text>
          {stale ? (
            <Alert color="orange" role="alert">
              Saved settings changed while this draft was being edited. Your draft has been kept.
              <Button
                mt="sm"
                variant="light"
                onClick={() => {
                  replaceDraft(createSkuDraft(item));
                }}
              >
                Load latest saved settings
              </Button>
            </Alert>
          ) : null}
          {isNew ? (
            <Autocomplete
              ref={skuInput}
              label="SKU"
              description="Type a SKU prefix to find existing settings, or enter a new exact SKU. Spelling and spaces are preserved."
              {...form.getInputProps("sku", { withError: false })}
              data={
                values.sku
                  ? knownSkus
                      .filter((sku) => sku.toLowerCase().startsWith(values.sku.toLowerCase()))
                      .slice(0, 20)
                  : []
              }
              filter={({ options }) => options}
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
                  onEditExisting(values.sku);
                }}
              >
                Edit existing SKU
              </Button>
            </Alert>
          ) : null}
          <Stack gap={4}>
            <Group justify="space-between" align="flex-start" gap="xs">
              <Text className="ui-input-label">Company</Text>
              <Button type="button" variant="subtle" size="compact-sm" onClick={onAddCompany}>
                Add company
              </Button>
            </Group>
            <NativeSelect
              aria-label="Company"
              data-autofocus={initialIssue?.field === "company_id" || undefined}
              value={unavailableCompany ? "" : (values.company_id ?? "")}
              data={[
                { value: "", label: "Choose a company" },
                ...companies.map((company) => ({ value: company.id, label: company.name })),
              ]}
              onChange={(event) => {
                form.setFieldValue("company_id", event.currentTarget.value || null);
              }}
              error={issues.find((issue) => issue.field === "company_id")?.message}
            />
          </Stack>
          <Divider />
          <Stack gap={4}>
            <Title order={3} size="h4" className="sku-configuration-section-title">
              Marketplace fee periods
            </Title>
            <Text size="sm" c="dimmed">
              Start dates are inclusive. End dates are exclusive; leave an end date blank for an
              ongoing rate. Enter 0 only when the agreed fee is zero.
            </Text>
          </Stack>
          {values.periods.length === 0 ? (
            <Text size="sm">
              No fee periods. Add a period when this SKU has transactions that require a fee.
            </Text>
          ) : null}
          {values.periods.map((period, index) => (
            <Fragment key={index}>
              <SkuFeePeriodEditor
                form={form}
                index={index}
                issues={issues}
                initialFocusField={
                  initialIssue?.periodIndex === index ? initialPeriodField : undefined
                }
                rateChangeOpen={editing.rateChange !== null}
                marketplaceRef={(element) => {
                  if (element) marketplaceInputs.current.set(index, element);
                  else marketplaceInputs.current.delete(index);
                }}
                onRemove={() => {
                  handleRemovePeriod(index);
                }}
                onChangeRate={() => {
                  startRateChange(index);
                }}
              />
              {editing.rateChange?.periodIndex === index ? (
                <SkuRateChange
                  sku={values.sku}
                  periods={values.periods}
                  draft={editing.rateChange}
                  onChange={setRateChange}
                  onApply={(periods) => {
                    const target =
                      editing.rateChange?.effectiveDate === period.valid_from ? index : index + 1;
                    replaceDraft({ ...form.getValues(), periods });
                    requestAnimationFrame(() => marketplaceInputs.current.get(target)?.focus());
                  }}
                  onCancel={() => {
                    setRateChange(null);
                    requestAnimationFrame(() => marketplaceInputs.current.get(index)?.focus());
                  }}
                />
              ) : null}
            </Fragment>
          ))}
          {coverageIssues.length > 0 ? (
            <Alert color="orange" title="Fee coverage still needed">
              <Stack gap={4}>
                {coverageIssues.map((issue, index) => (
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
              <Button variant="default" onClick={onDiscard}>
                Discard edits
              </Button>
              <Button type="submit" disabled={existingSku || editing.rateChange !== null}>
                Keep draft
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
