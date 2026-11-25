import { useEffect, useRef } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import type { SaveError } from "./save-error";
import type { SkuFormIssue } from "./sku-configuration-form";
import { SkuConfigurationReviewCard } from "./SkuConfigurationReviewCard";
import { DetailDrawer } from "./DetailDrawer";
import { HelpPopover } from "./HelpPopover";
import { SavedSettingsAlert } from "./SavedSettingsAlert";
import { FEE_STATUS_LABELS } from "./fee-status";
import "./EditingDrawer.css";
import "./SkuConfigurationDrawer.css";

const GAP_SHORTCUT_LIMIT = 5;

export function SkuConfigurationReview({
  drafts,
  unfinishedCount,
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
  unfinishedCount: number;
  savedItems: SkuConfigurationItem[];
  companies: Map<string, string>;
  issues: SkuFormIssue[];
  changeReason: string;
  onReasonChange: (value: string) => void;
  isSaving: boolean;
  blocked: boolean;
  saveProblem: SaveError | null;
  isReloading: boolean;
  onReloadSaved: () => void;
  onSave: () => void;
  onEdit: (sku: string) => void;
  onDiscard: (sku: string) => void;
  onShowIncomplete: () => void;
  onClose: () => void;
}) {
  const incomplete = [...new Set(issues.map((issue) => issue.sku))];
  const needsSetup = `${String(incomplete.length)} ${incomplete.length === 1 ? "SKU needs" : "SKUs need"} setup`;
  const savedBySku = new Map(savedItems.map((item) => [item.sku, item]));
  const issuesRef = useRef<HTMLDivElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const backButton = useRef<HTMLButtonElement>(null);
  const pendingDiscardFocus = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const sku = pendingDiscardFocus.current;
    if (sku === undefined) return;
    const target = sku === null ? backButton.current : editButtons.current.get(sku);
    (target ?? backButton.current)?.focus();
    pendingDiscardFocus.current = undefined;
  }, [drafts]);
  function discardDraft(sku: string) {
    const index = drafts.findIndex((draft) => draft.sku === sku);
    const adjacentDraft = drafts.at(index + 1) ?? (index > 0 ? drafts.at(index - 1) : undefined);
    pendingDiscardFocus.current = adjacentDraft?.sku ?? null;
    onDiscard(sku);
  }
  return (
    <DetailDrawer
      opened
      title="Review changes"
      context={`Current fees · ${String(drafts.length)} SKU ${drafts.length === 1 ? "change" : "changes"}`}
      width="wide"
      classNames={{
        content: "editing-drawer-content",
        body: "editing-drawer-body",
      }}
      onClose={onClose}
      closeOnEscape={!isSaving}
      closeOnClickOutside={!isSaving}
      closeDisabled={isSaving}
    >
      <div className="editing-drawer-layout">
        <Stack gap="md" className="editing-drawer-scroll">
          {drafts.length === 0 ? <Text>No changes to save</Text> : null}
          <Group gap={6} wrap="nowrap">
            <Text size="sm" c="dimmed">
              Company changes also apply to past transactions.
            </Text>
            <HelpPopover label="Save help">
              Fee rates follow their dates. Saved payout reports keep their values.
            </HelpPopover>
          </Group>
          {unfinishedCount ? (
            <Alert color="orange">
              {unfinishedCount} unfinished {unfinishedCount === 1 ? "edit" : "edits"} not included.
            </Alert>
          ) : null}
          {saveProblem ? (
            <SavedSettingsAlert
              color="red"
              title={saveProblem.title}
              inline
              refreshing={isReloading}
              onRefresh={onReloadSaved}
            >
              {saveProblem.detail}
            </SavedSettingsAlert>
          ) : null}
          {drafts.map((draft) => (
            <SkuConfigurationReviewCard
              key={draft.sku}
              draft={draft}
              saved={savedBySku.get(draft.sku)}
              companies={companies}
              isSaving={isSaving}
              editButtonRef={(element) => {
                if (element) editButtons.current.set(draft.sku, element);
                else editButtons.current.delete(draft.sku);
              }}
              onEdit={onEdit}
              onDiscard={discardDraft}
            />
          ))}
          {incomplete.length ? (
            <Alert
              ref={issuesRef}
              tabIndex={-1}
              color="orange"
              title={FEE_STATUS_LABELS["needs-setup"]}
            >
              <Stack gap={4} align="flex-start">
                {incomplete.slice(0, GAP_SHORTCUT_LIMIT).map((sku) => (
                  <Button
                    key={sku}
                    className="sku-configuration-setup-shortcut"
                    size="compact-sm"
                    variant="subtle"
                    disabled={isSaving}
                    onClick={() => {
                      onEdit(sku);
                    }}
                  >
                    Complete {sku}
                  </Button>
                ))}
                {incomplete.length > GAP_SHORTCUT_LIMIT ? (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    disabled={isSaving}
                    onClick={onShowIncomplete}
                  >
                    View all in Current fees
                  </Button>
                ) : null}
              </Stack>
            </Alert>
          ) : null}
        </Stack>
        <Stack gap="sm" className="editing-drawer-actions">
          {incomplete.length ? (
            <Group justify="space-between" gap="xs">
              <Text size="sm" c="var(--ui-status-warning-text)">
                {needsSetup}
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                aria-label="Show SKUs that need setup"
                onClick={() => {
                  issuesRef.current?.scrollIntoView({ block: "start" });
                  issuesRef.current?.focus({ preventScroll: true });
                }}
              >
                Show SKUs
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
            <Button ref={backButton} variant="default" disabled={isSaving} onClick={onClose}>
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
    </DetailDrawer>
  );
}
