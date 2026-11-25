import {
  Fragment,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
  type SubmitEvent,
  type SyntheticEvent,
} from "react";
import { Alert, Autocomplete, Button, Divider, Group, Stack, Text, Title } from "@mantine/core";
import type { Company, SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { SkuFeePeriodEditor } from "./SkuFeePeriodEditor";
import { createSkuDraft, showsFieldError, validateSkuItem } from "./sku-configuration-form";
import type { FeeEditorState } from "./workspace-view-state";
import "./EditingDrawer.css";
import "./SkuConfigurationDrawer.css";
import { SkuRateChange } from "./SkuRateChange";
import { useSkuEditorForm } from "./use-sku-editor-form";
import { SkuConfigurationMetadata } from "./SkuConfigurationMetadata";
import { HelpPopover } from "./HelpPopover";
import { CompanyField } from "./CompanyField";
import { SkuConfigurationIssues } from "./SkuConfigurationIssues";
import { FEE_PERIOD_UNTIL } from "./fee-period-labels";

export function SkuConfigurationEditor({
  item,
  editing,
  onEditingChange,
  companies,
  knownSkus,
  onDiscard,
  onStage,
  onEditExisting,
  onAddCompany,
  onShowTransactions,
  onBackToDetails,
}: {
  item: SkuConfigurationItem;
  editing: FeeEditorState;
  onEditingChange: Dispatch<SetStateAction<FeeEditorState>>;
  companies: Company[];
  knownSkus: string[];
  onDiscard: () => void;
  onStage: (change: SkuConfigurationChange) => void;
  onEditExisting: (sku: string) => void;
  onAddCompany: () => void;
  onShowTransactions: () => void;
  onBackToDetails: () => void;
}) {
  const { form, loadDraft, applyRateChange, visit, startRateChange, setRateChange, removePeriod } =
    useSkuEditorForm(editing, onEditingChange);
  const values = form.values;
  const { isNew, submitError } = editing;
  const skuInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const target =
      formRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      formRef.current?.querySelector<HTMLElement>("select");
    target?.focus();
  }, []);
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
  function visitField(event: SyntheticEvent) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const path = target.closest("[data-path]")?.getAttribute("data-path");
    if (path) visit(path);
  }
  const knownCompanyIds = new Set(companies.map(({ id }) => id));
  const issues = validateSkuItem(
    { ...item, ...values },
    knownCompanyIds,
    !values.company_id && Boolean(item.company_id),
  );
  const coverageIssues = issues.filter((issue) => issue.gap);
  const fieldIssues = issues.filter((issue) => showsFieldError(issue, values, editing.visited));
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
    const skuIssue = issues.find((issue) => issue.field === "sku");
    if (skuIssue) {
      showSkuError(skuIssue.message);
      return;
    }
    if (existingSku) {
      showSkuError("This SKU already exists.");
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
    <form
      ref={formRef}
      className="editing-drawer-layout drawer-panel-enter"
      onSubmit={stageDraft}
      onChangeCapture={visitField}
      onBlurCapture={visitField}
      onFocusCapture={(event) => {
        const target = event.target;
        if (target.hasAttribute("data-autofocus") && target.getAttribute("aria-invalid") === "true")
          requestAnimationFrame(() => {
            if (document.activeElement === target) target.scrollIntoView({ block: "center" });
          });
      }}
    >
      <div className="editing-drawer-scroll">
        <Stack gap="md">
          {!isNew ? (
            <Group justify="space-between">
              <Button variant="subtle" size="compact-sm" onClick={onBackToDetails}>
                Back to details
              </Button>
              <Button
                variant="subtle"
                size="compact-sm"
                aria-label={`View transactions for ${item.sku}`}
                onClick={onShowTransactions}
              >
                View transactions
              </Button>
            </Group>
          ) : null}
          {stale ? (
            <Alert color="orange" role="alert">
              Saved settings changed. Your draft is kept.
              <Button
                mt="sm"
                variant="light"
                onClick={() => {
                  loadDraft(createSkuDraft(item));
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
              description="Exact SKU; spaces and letter case matter."
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
            <Alert color="blue" title="This SKU already exists">
              <Button
                variant="light"
                onClick={() => {
                  onEditExisting(values.sku);
                }}
              >
                Edit existing SKU
              </Button>
            </Alert>
          ) : null}
          <div data-path="company_id">
            <CompanyField
              companies={companies}
              value={unavailableCompany ? "" : (values.company_id ?? "")}
              emptyLabel={item.terms_version_id ? "Unassigned" : "Choose a company"}
              initialFocus={initialIssue?.field === "company_id"}
              error={fieldIssues.find((issue) => issue.field === "company_id")?.message}
              onChange={(companyId) => {
                form.setFieldValue("company_id", companyId);
              }}
              onAddCompany={onAddCompany}
            />
          </div>
          <Divider />
          <Group gap={6} wrap="nowrap">
            <Title order={3} size="h4" className="sku-configuration-section-title">
              Marketplace fee periods
            </Title>
            <HelpPopover label="Marketplace fee periods help">
              Leave {FEE_PERIOD_UNTIL} blank for an ongoing rate. Enter 0 only for an agreed zero
              fee.
            </HelpPopover>
          </Group>
          {values.periods.length === 0 ? <Text size="sm">No fee periods</Text> : null}
          {values.periods.map((period, index) => (
            <Fragment key={index}>
              <SkuFeePeriodEditor
                form={form}
                index={index}
                issues={fieldIssues}
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
                    applyRateChange(index, periods);
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
          <SkuConfigurationIssues sku={values.sku} issues={coverageIssues} />
        </Stack>
        {!isNew ? <SkuConfigurationMetadata item={item} /> : null}
      </div>
      <Group justify="space-between" className="editing-drawer-actions">
        <Button ref={addPeriodButton} variant="light" onClick={addPeriod} disabled={existingSku}>
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
    </form>
  );
}
