import { useMemo } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationEditor } from "./SkuConfigurationEditor";
import { DetailDrawer } from "./DetailDrawer";
import { SkuConfigurationDetails } from "./SkuConfigurationDetails";
import { SkuFeeSchedules } from "./SkuFeeSchedules";
import { SkuConfigurationReview } from "./SkuConfigurationReview";
import { SkuConfigurationList } from "./SkuConfigurationList";
import type { useSkuConfiguration } from "./use-sku-configuration";
import { newSkuItem, resolveSkuConfiguration } from "./sku-configuration-form";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage } from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import { WorkspaceHeader } from "./WorkspaceHeader";
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
  updating = false,
}: {
  identity: Identity;
  controller: ReturnType<typeof useSkuConfiguration>;
  onShowTransactions: (sku: string) => void;
  onAddCompany: () => void;
  updating?: boolean;
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
  const nextIncompleteSku = issuesBySku.keys().next().value;
  const {
    panelRef,
    selectSku,
    closeDetails,
    backToDetails,
    editSku,
    addSku,
    updateEditor,
    resumeEditor,
    closeEditor,
    discardEdits,
    discardDraft,
    showSetupIssues,
    stage,
    setReviewing,
  } = useFeeEditor(savedItems, viewState, onViewStateChange);
  const editorItem = editing
    ? (savedItems.find((item) => item.sku === editing.sku) ?? newSkuItem(editing.sku))
    : null;
  const selectedItem = effectiveItems.find((item) => item.sku === viewState.selectedSku) ?? null;
  const selectedSavedItem = savedItems.find((item) => item.sku === viewState.selectedSku) ?? null;
  const selectedHasDraft =
    administrator && drafts.some((draft) => draft.sku === viewState.selectedSku);
  return (
    <div ref={panelRef} tabIndex={-1} className="fee-panel">
      <WorkspaceHeader
        title="Current fees"
        status={
          configuration.isPending
            ? "loading"
            : configuration.isFetching || updating
              ? "updating"
              : null
        }
        help={
          <>
            <p>
              Review each SKU's company assignment and marketplace fee periods. Select a SKU to view
              its transactions.
            </p>
            <p>
              {administrator
                ? "Edits are saved as drafts. Review changes lets you check the full batch before publishing; closing an editor keeps unfinished work."
                : "Your company's assignments and fee periods are read-only. Contact an administrator to change them."}
            </p>
            <p>
              Needs setup indicates a missing company assignment or applicable fee periods.{" "}
              {administrator
                ? "Complete changes to other SKUs can still be saved."
                : "Contact an administrator to complete missing settings."}
            </p>
          </>
        }
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
      {isSaving ? (
        <Text role="status" mb="sm">
          {savedNotice ? "Refreshing saved settings…" : "Saving configuration changes…"}
        </Text>
      ) : null}
      {configuration.isError ? (
        <Alert role="alert" color="red" mb="md">
          Could not load assignments and fees. {getErrorMessage(configuration.error)}
          <Button variant="subtle" onClick={() => void reloadSaved()}>
            Retry configuration
          </Button>
        </Alert>
      ) : null}
      {savedNotice ? (
        <Alert role="status" color="green" mb="md">
          {savedNotice}
        </Alert>
      ) : null}
      {refreshFailed ? (
        <Alert role="alert" color="orange" mb="md">
          Your changes were saved, but the displayed settings could not be refreshed.
          <Button variant="subtle" onClick={() => void reloadSaved()}>
            Refresh saved settings
          </Button>
        </Alert>
      ) : null}
      {viewState.saveProblem && !reviewing ? (
        <Alert role="alert" color="red" mb="md">
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
          {nextIncompleteSku !== undefined ? (
            <Alert color="orange" mb="md">
              <Group justify="space-between" gap="xs">
                <Text size="sm" fw={500} c="var(--ui-text)">
                  {issuesBySku.size} {issuesBySku.size === 1 ? "SKU needs" : "SKUs need"} setup
                </Text>
                {administrator ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={isSaving}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      editSku(nextIncompleteSku);
                    }}
                  >
                    Complete next SKU
                  </Button>
                ) : null}
              </Group>
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
            onSelect={selectSku}
            viewState={viewState}
            onViewStateChange={onViewStateChange}
          />
        </>
      ) : null}
      <DetailDrawer
        opened={Boolean(configuration.data && (selectedItem ?? (administrator && editing)))}
        title={editing ? (editing.isNew ? "Add SKU" : `Edit ${editing.sku}`) : "Fee details"}
        closeLabel={editing ? "Close SKU editor" : "Close fee details"}
        size="min(960px, 100vw)"
        classNames={{
          content: "sku-configuration-drawer-content",
          body: "sku-configuration-drawer-body",
          title: "sku-configuration-drawer-title",
        }}
        onClose={editing ? closeEditor : closeDetails}
      >
        {administrator && configuration.data && editorItem && editing ? (
          <SkuConfigurationEditor
            key={editing.sku}
            item={editorItem}
            editing={editing}
            onEditingChange={updateEditor}
            companies={identity.companies}
            knownSkus={effectiveItems.map((item) => item.sku)}
            onEditExisting={editSku}
            onDiscard={discardEdits}
            onStage={stage}
            onAddCompany={onAddCompany}
            onBackToDetails={backToDetails}
            onShowTransactions={() => {
              closeEditor();
              onShowTransactions(editing.sku);
            }}
          />
        ) : selectedItem ? (
          <SkuConfigurationDetails
            item={selectedItem}
            savedItem={selectedSavedItem}
            companyName={companyLabel(selectedItem.company_id, companies)}
            issues={issuesBySku.get(selectedItem.sku) ?? []}
            administrator={administrator}
            isSaving={isSaving}
            hasDraft={selectedHasDraft}
            schedules={
              <SkuFeeSchedules
                identity={identity}
                item={selectedItem}
                savedItem={selectedSavedItem}
                companies={companies}
                hasDraft={selectedHasDraft}
              />
            }
            hasUnfinishedEdit={viewState.editorDrafts.some(
              (draft) => draft.sku === selectedItem.sku,
            )}
            onEdit={() => {
              editSku(selectedItem.sku);
            }}
            onDiscardDraft={() => {
              discardDraft(selectedItem.sku);
            }}
            onShowTransactions={(sku) => {
              closeDetails();
              onShowTransactions(sku);
            }}
          />
        ) : null}
      </DetailDrawer>
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
          onDiscard={discardDraft}
          onShowIncomplete={showSetupIssues}
          onClose={() => {
            setReviewing(false);
          }}
        />
      ) : null}
    </div>
  );
}
