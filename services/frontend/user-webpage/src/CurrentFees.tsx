import { useMemo } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationEditor } from "./SkuConfigurationEditor";
import { SkuConfigurationReview } from "./SkuConfigurationReview";
import { SkuConfigurationList } from "./SkuConfigurationList";
import type { useSkuConfiguration } from "./use-sku-configuration";
import { newSkuItem, resolveSkuConfiguration } from "./sku-configuration-form";
import type { Identity } from "./auth-session";
import { DATASET_PRESENTATION, getErrorMessage } from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { useFeeEditor } from "./use-fee-editor";
import { FeeDraftStatus } from "./FeeDraftStatus";

const EMPTY_ITEMS: SkuConfigurationItem[] = [];

export function CurrentFees({
  identity,
  controller,
  viewState,
  onViewStateChange,
  onShowTransactions,
  onAddCompany,
}: {
  identity: Identity;
  controller: ReturnType<typeof useSkuConfiguration>;
  onShowTransactions: (sku: string) => void;
  onAddCompany: () => void;
} & ViewStateProps<FeeViewState>) {
  const administrator = identity.account.access_role === "administrator";
  const { drafts, editing, reviewing } = viewState;
  const { configuration, save, isSaving, reloadSaved, savedNotice, refreshFailed } = controller;
  const companies = useMemo(
    () => new Map(identity.companies.map((company) => [company.id, company.name])),
    [identity.companies],
  );
  const savedItems = configuration.data?.items ?? EMPTY_ITEMS;
  const {
    items: effectiveItems,
    draftIssues,
    issuesBySku,
  } = useMemo(
    () => resolveSkuConfiguration(savedItems, drafts, new Set(companies.keys())),
    [savedItems, drafts, companies],
  );
  const incompleteSkus = new Set(issuesBySku.keys());
  const {
    panelRef,
    editSku,
    addSku,
    updateEditor,
    resumeEditor,
    closeEditor,
    stage,
    setReviewing,
  } = useFeeEditor(savedItems, viewState, onViewStateChange);
  const editorItem = editing
    ? (savedItems.find((item) => item.sku === editing.sku) ?? newSkuItem(editing.sku))
    : null;
  return (
    <Stack ref={panelRef} tabIndex={-1} gap="md" className="fee-panel">
      <WorkspaceIntro
        title="Assignments and fees"
        description={DATASET_PRESENTATION.fees.description}
        actions={
          administrator ? (
            <Group gap="xs" align="flex-start">
              <Button variant="light" onClick={onAddCompany}>
                Add company
              </Button>
              <Button
                variant="light"
                disabled={!configuration.data || configuration.isError || isSaving}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  addSku();
                }}
              >
                Add SKU
              </Button>
            </Group>
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
                  ? "These SKUs need a company or required fee periods. Complete changes to other SKUs can still be saved."
                  : "Some applicable transactions are missing fee settings. Contact your administrator."}
              </Text>
              {administrator ? (
                <Button
                  mt="sm"
                  variant="light"
                  disabled={isSaving}
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    editSku([...incompleteSkus][0]);
                  }}
                >
                  Complete next SKU
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {administrator ? (
            <FeeDraftStatus
              draftCount={drafts.length}
              unfinishedCount={viewState.editorDrafts.length}
              reviewDisabled={configuration.isError || isSaving}
              onResume={resumeEditor}
              onReview={() => {
                setReviewing(true);
              }}
            />
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
          onEditingChange={updateEditor}
          companies={identity.companies}
          knownSkus={effectiveItems.map((item) => item.sku)}
          onEditExisting={editSku}
          isNew={editing.isNew}
          onClose={closeEditor}
          onDiscard={() => {
            closeEditor(true);
          }}
          onStage={stage}
          onAddCompany={onAddCompany}
        />
      ) : null}
      {administrator && configuration.data && reviewing ? (
        <SkuConfigurationReview
          drafts={drafts}
          unfinishedCount={viewState.editorDrafts.length}
          savedItems={savedItems}
          companies={companies}
          issues={draftIssues}
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
