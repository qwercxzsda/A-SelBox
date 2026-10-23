import { useEffect, useRef } from "react";
import { Alert, Button, Drawer, Group, Stack, Text, TextInput } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import { SkuConfigurationReviewCard } from "./SkuConfigurationReviewCard";
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
          {unfinishedCount ? (
            <Alert color="orange">
              {unfinishedCount} unfinished {unfinishedCount === 1 ? "edit is" : "edits are"} not
              part of this save. Return to editing and choose Keep draft to include{" "}
              {unfinishedCount === 1 ? "it" : "them"}.
            </Alert>
          ) : null}
          {saveProblem ? (
            <Alert role="alert" color="red">
              <Text size="sm">{saveProblem}</Text>
              <Button variant="subtle" loading={isReloading} onClick={onReloadSaved}>
                Refresh saved settings
              </Button>
            </Alert>
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
              title={`${String(incomplete.length)} ${incomplete.length === 1 ? "SKU needs" : "SKUs need"} setup before saving`}
            >
              <Text size="sm">
                Each changed SKU needs a company and all required fee periods. Setup gaps in other
                SKUs do not block this draft.
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
                    View all setup gaps in Current fees
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
    </Drawer>
  );
}
