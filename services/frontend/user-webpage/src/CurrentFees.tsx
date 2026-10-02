import { useMemo } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { SkuConfigurationEditor } from "./SkuConfigurationEditor";
import { SkuConfigurationReview } from "./SkuConfigurationReview";
import { SkuConfigurationList } from "./SkuConfigurationList";
import type { useSkuConfiguration } from "./use-sku-configuration";
import { createSkuDraft, newSkuItem, resolveSkuConfiguration } from "./sku-configuration-form";
import type { Identity } from "./auth-session";
import { DATASET_PRESENTATION, getErrorMessage } from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import { WorkspaceIntro } from "./WorkspaceIntro";

const EMPTY_ITEMS: SkuConfigurationItem[] = [];

export function CurrentFees({
  identity,
  controller,
  viewState,
  onViewStateChange,
  onShowTransactions,
}: {
  identity: Identity;
  controller: ReturnType<typeof useSkuConfiguration>;
  onShowTransactions: (sku: string) => void;
} & ViewStateProps<FeeViewState>) {
  const administrator = identity.account.access_role === "operator";
  const { drafts, editing, reviewing } = viewState;
  const setEditing = (editing: FeeViewState["editing"]) => {
    onViewStateChange((current) => ({ ...current, editing }));
  };
  const setReviewing = (reviewing: boolean) => {
    onViewStateChange((current) => ({ ...current, reviewing }));
  };
  const { configuration, save, isSaving, reloadSaved, savedNotice, refreshFailed, clearNotice } =
    controller;
  const companies = useMemo(
    () => new Map(identity.companies.map((company) => [company.id, company.name])),
    [identity.companies],
  );
  const savedItems = configuration.data?.items ?? EMPTY_ITEMS;
  const {
    items: effectiveItems,
    issues,
    issuesBySku,
  } = useMemo(() => resolveSkuConfiguration(savedItems, drafts), [savedItems, drafts]);
  const incompleteSkus = new Set(issuesBySku.keys());
  function editSku(sku: string) {
    const saved = savedItems.find((item) => item.sku === sku) ?? newSkuItem(sku);
    onViewStateChange((current) => ({
      ...current,
      reviewing: false,
      editing: {
        sku,
        isNew: false,
        form: structuredClone(
          current.drafts.find((draft) => draft.sku === sku) ?? createSkuDraft(saved),
        ),
        submitError: null,
      },
    }));
  }
  function stage(change: SkuConfigurationChange) {
    onViewStateChange((current) => ({
      ...current,
      drafts: [...current.drafts.filter((draft) => draft.sku !== change.sku), change],
      expanded: [...new Set([...current.expanded, change.sku])],
    }));
    setEditing(null);
    clearNotice();
  }
  const editorItem = editing
    ? (savedItems.find((item) => item.sku === editing.sku) ?? newSkuItem(editing.sku))
    : null;
  return (
    <Stack gap="md" className="fee-panel">
      <WorkspaceIntro
        title="Assignments and fees"
        description={DATASET_PRESENTATION.fees.description}
        actions={
          administrator ? (
            <Button
              variant="light"
              disabled={!configuration.data || configuration.isError || isSaving}
              onClick={() => {
                setEditing({
                  sku: "",
                  isNew: true,
                  form: createSkuDraft(newSkuItem("")),
                  submitError: null,
                });
              }}
            >
              Add SKU
            </Button>
          ) : null
        }
      />
      {configuration.isPending ? <Text role="status">Loading assignments and fees…</Text> : null}
      {isSaving ? (
        <Text role="status">
          {savedNotice ? "Refreshing saved settings…" : "Saving configuration changes…"}
        </Text>
      ) : null}
      {configuration.isError ? (
        <Alert role="alert" color="red">
          Could not load assignments and fees. {getErrorMessage(configuration.error)}
          <Button variant="subtle" onClick={() => void reloadSaved()}>
            Retry configuration
          </Button>
        </Alert>
      ) : null}
      {savedNotice ? (
        <Alert role="status" color="green">
          {savedNotice}
        </Alert>
      ) : null}
      {refreshFailed ? (
        <Alert role="alert" color="orange">
          Your changes were saved, but the displayed settings could not be refreshed.
          <Button variant="subtle" onClick={() => void reloadSaved()}>
            Refresh saved settings
          </Button>
        </Alert>
      ) : null}
      {viewState.saveProblem && !reviewing ? (
        <Alert role="alert" color="red">
          <Text size="sm">{viewState.saveProblem}</Text>
          <Text size="sm">Your drafts are still available.</Text>
          <Button
            variant="subtle"
            loading={configuration.isFetching}
            onClick={() => void reloadSaved()}
          >
            Refresh saved settings
          </Button>
        </Alert>
      ) : null}
      {configuration.data ? (
        <>
          {incompleteSkus.size > 0 ? (
            <Alert
              color="orange"
              title={`${String(incompleteSkus.size)} ${incompleteSkus.size === 1 ? "SKU needs" : "SKUs need"} setup`}
            >
              <Text size="sm">
                {administrator
                  ? "Every known SKU needs a company and fee coverage for all applicable transactions before changes can be saved."
                  : "Some applicable transactions are missing fee settings. Contact your administrator."}
              </Text>
              {administrator ? (
                <Button
                  mt="sm"
                  variant="light"
                  disabled={isSaving}
                  onClick={() => {
                    editSku([...incompleteSkus][0]);
                  }}
                >
                  Complete next SKU
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {administrator ? (
            <Group justify="space-between" className="fee-draft-status">
              <Text size="sm">
                {drafts.length
                  ? `${String(drafts.length)} SKU ${drafts.length === 1 ? "draft" : "drafts"} · not saved yet`
                  : "No unsaved changes."}
              </Text>
              <Button
                disabled={drafts.length === 0 || configuration.isError || isSaving}
                onClick={() => {
                  setReviewing(true);
                }}
              >
                Review changes{drafts.length ? ` (${String(drafts.length)})` : ""}
              </Button>
            </Group>
          ) : null}
          <SkuConfigurationList
            items={effectiveItems}
            companies={companies}
            issuesBySku={issuesBySku}
            administrator={administrator}
            isSaving={isSaving}
            onEdit={editSku}
            onShowTransactions={onShowTransactions}
            viewState={viewState}
            onViewStateChange={onViewStateChange}
          />
        </>
      ) : null}
      {administrator && configuration.data && editorItem && editing ? (
        <SkuConfigurationEditor
          key={editing.sku}
          item={editorItem}
          editing={editing}
          onEditingChange={(update) => {
            onViewStateChange((current) => ({
              ...current,
              editing: current.editing
                ? typeof update === "function"
                  ? update(current.editing)
                  : update
                : null,
            }));
          }}
          companies={identity.companies}
          knownSkus={effectiveItems.map((item) => item.sku)}
          onEditExisting={editSku}
          isNew={editing.isNew}
          onClose={() => {
            setEditing(null);
          }}
          onStage={stage}
        />
      ) : null}
      {administrator && configuration.data && reviewing ? (
        <SkuConfigurationReview
          drafts={drafts}
          savedItems={savedItems}
          companies={companies}
          issues={issues}
          changeReason={viewState.changeReason}
          onReasonChange={(value) => {
            onViewStateChange((current) => ({ ...current, changeReason: value }));
          }}
          isSaving={isSaving}
          blocked={viewState.requiresReload || configuration.isError || configuration.isFetching}
          saveProblem={viewState.saveProblem}
          isReloading={configuration.isFetching}
          onReloadSaved={() => void reloadSaved()}
          onSave={() => {
            save.mutate(
              { changes: structuredClone(drafts), changeReason: viewState.changeReason },
              {
                onSettled: () => {
                  setReviewing(false);
                },
              },
            );
          }}
          onEdit={editSku}
          onDiscard={(sku) => {
            onViewStateChange((current) => ({
              ...current,
              drafts: current.drafts.filter((draft) => draft.sku !== sku),
            }));
          }}
          onShowIncomplete={() => {
            setReviewing(false);
            onViewStateChange((current) => ({
              ...current,
              onlyIncomplete: true,
              search: "",
              pageIndex: 0,
            }));
          }}
          onClose={() => {
            setReviewing(false);
          }}
        />
      ) : null}
    </Stack>
  );
}
