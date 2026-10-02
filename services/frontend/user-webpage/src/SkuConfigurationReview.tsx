import { useRef } from "react";
import { Alert, Button, Drawer, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import { companyLabel } from "./view-model";
import { SkuFeePeriods } from "./SkuFeePeriods";
import { SkuConfigurationChanges } from "./SkuConfigurationChanges";
import "./SkuConfigurationDrawer.css";

const GAP_SHORTCUT_LIMIT = 5;

export function SkuConfigurationReview({
  drafts,
  savedItems,
  companies,
  issues,
  changeReason,
  onReasonChange,
  isSaving,
  blocked,
  saveProblem,
  isReloading,
  onReloadSaved,
  onSave,
  onEdit,
  onDiscard,
  onShowIncomplete,
  onClose,
}: {
  drafts: SkuConfigurationChange[];
  savedItems: SkuConfigurationItem[];
  companies: Map<string, string>;
  issues: SkuFormIssue[];
  changeReason: string;
  onReasonChange: (value: string) => void;
  isSaving: boolean;
  blocked: boolean;
  saveProblem: string | null;
  isReloading: boolean;
  onReloadSaved: () => void;
  onSave: () => void;
  onEdit: (sku: string) => void;
  onDiscard: (sku: string) => void;
  onShowIncomplete: () => void;
  onClose: () => void;
}) {
  const incomplete = [...new Set(issues.map((issue) => issue.sku))];
  const savedBySku = new Map(savedItems.map((item) => [item.sku, item]));
  const issuesRef = useRef<HTMLDivElement>(null);
  return (
    <Drawer
      opened
      title="Review configuration changes"
      position="right"
      size={960}
      classNames={{
        content: "sku-configuration-drawer-content",
        body: "sku-configuration-drawer-body",
        title: "sku-configuration-drawer-title",
      }}
      onClose={onClose}
      closeOnEscape={!isSaving}
      closeOnClickOutside={!isSaving}
      closeButtonProps={{ disabled: isSaving, "aria-label": "Close configuration review" }}
    >
      <div className="sku-configuration-drawer-layout">
        <Stack gap="md" className="sku-configuration-drawer-scroll">
          <Text>
            {drafts.length
              ? `${String(drafts.length)} SKU ${drafts.length === 1 ? "change" : "changes"} ready for review. All changes will be saved together.`
              : "No drafts remain. Return to editing to make changes."}
          </Text>
          <Text size="sm" c="dimmed">
            Company assignments apply to all live transaction history for each SKU. Fee rates follow
            their configured dates. Previously saved payout reports keep their original values.
          </Text>
          {saveProblem ? (
            <Alert role="alert" color="red">
              <Text size="sm">{saveProblem}</Text>
              <Button variant="subtle" loading={isReloading} onClick={onReloadSaved}>
                Refresh saved settings
              </Button>
            </Alert>
          ) : null}
          {drafts.map((draft) => (
            <Paper withBorder p="md" key={draft.sku} className="sku-configuration-card">
              <Group justify="space-between" align="start">
                <div className="sku-configuration-card-identity">
                  <Text fw={600} className="sku-configuration-card-sku">
                    {draft.sku}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {companyLabel(draft.company_id, companies)} · {draft.periods.length} fee{" "}
                    {draft.periods.length === 1 ? "period" : "periods"}
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    variant="light"
                    aria-label={`Edit ${draft.sku}`}
                    disabled={isSaving}
                    onClick={() => {
                      onEdit(draft.sku);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="subtle"
                    color="#9e1834"
                    disabled={isSaving}
                    aria-label={`Discard draft for ${draft.sku}`}
                    onClick={() => {
                      onDiscard(draft.sku);
                    }}
                  >
                    Discard draft
                  </Button>
                </Group>
              </Group>
              <SkuConfigurationChanges
                draft={draft}
                saved={savedBySku.get(draft.sku)}
                companies={companies}
              />
              <div className="sku-configuration-proposed-periods">
                <Text fw={600} size="sm" mb="xs">
                  Proposed fee periods
                </Text>
                {draft.periods.length > 0 ? (
                  <SkuFeePeriods item={draft} />
                ) : (
                  <Text size="sm" c="dimmed">
                    No fee periods.
                  </Text>
                )}
              </div>
            </Paper>
          ))}
          {incomplete.length ? (
            <Alert
              ref={issuesRef}
              tabIndex={-1}
              color="orange"
              title={`${String(incomplete.length)} ${incomplete.length === 1 ? "SKU needs" : "SKUs need"} setup before saving`}
            >
              <Text size="sm">
                Every known SKU must have a company and all required fee periods, including SKUs
                outside this draft.
              </Text>
              <Stack gap="xs" mt="sm">
                {incomplete.slice(0, GAP_SHORTCUT_LIMIT).map((sku) => (
                  <Button
                    key={sku}
                    className="sku-configuration-setup-shortcut"
                    variant="light"
                    disabled={isSaving}
                    onClick={() => {
                      onEdit(sku);
                    }}
                  >
                    Complete {sku}
                  </Button>
                ))}
                {incomplete.length > GAP_SHORTCUT_LIMIT ? (
                  <Button variant="subtle" disabled={isSaving} onClick={onShowIncomplete}>
                    View all {incomplete.length} SKUs needing setup
                  </Button>
                ) : null}
              </Stack>
            </Alert>
          ) : null}
        </Stack>
        <Stack gap="sm" className="sku-configuration-drawer-actions">
          {incomplete.length ? (
            <Group justify="space-between" gap="xs">
              <Text size="sm" c="orange.9">
                Complete fee setup before saving.
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={() => {
                  issuesRef.current?.scrollIntoView({ block: "start" });
                  issuesRef.current?.focus({ preventScroll: true });
                }}
              >
                Show setup issues ({incomplete.length})
              </Button>
            </Group>
          ) : null}
          <TextInput
            label="Reason for changes (optional)"
            value={changeReason}
            disabled={isSaving}
            onChange={(event) => {
              onReasonChange(event.currentTarget.value);
            }}
          />
          <Group justify="space-between">
            <Button variant="default" disabled={isSaving} onClick={onClose}>
              Back to editing
            </Button>
            <Button
              loading={isSaving}
              disabled={blocked || issues.length > 0 || drafts.length === 0}
              onClick={onSave}
            >
              Save all changes
            </Button>
          </Group>
        </Stack>
      </div>
    </Drawer>
  );
}
