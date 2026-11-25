import { useMemo } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuConfigurationReview } from "./SkuConfigurationReview";
import { SkuConfigurationList } from "./SkuConfigurationList";
import type { useSkuConfiguration } from "./use-sku-configuration";
import { resolveSkuConfiguration } from "./sku-configuration-form";
import type { Identity } from "./auth-session";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useFeeEditor } from "./use-fee-editor";
import { FeeDraftStatus } from "./FeeDraftStatus";
import { ErrorAlert } from "./ErrorAlert";
import { SavedSettingsAlert } from "./SavedSettingsAlert";
import { CurrentFeesDrawer } from "./CurrentFeesDrawer";
import { loadErrorDetail } from "./load-error";
import { NeedsSetupAlert } from "./NeedsSetupAlert";

const EMPTY_ITEMS: SkuConfigurationItem[] = [];

function CurrentFeesHelp({ administrator }: { administrator: boolean }) {
  return (
    <>
      <p>
        Review each SKU's company and marketplace fee periods. Select a SKU to view its
        transactions.
      </p>
      <p>
        {administrator
          ? "Edits stay as unsaved drafts until you save them in Review changes. Closing an editor keeps unfinished edits."
          : "Companies and fee periods are read-only."}
      </p>
      <p>
        Needs setup means a missing company or a missing fee rate.{" "}
        {administrator
          ? "Complete changes to other SKUs can still be saved."
          : "Contact an administrator to change or complete settings."}
      </p>
    </>
  );
}

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
  const { drafts, reviewing } = viewState;
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
  const feeEditor = useFeeEditor(savedItems, viewState, onViewStateChange);
  const { panelRef, editSku, setReviewing } = feeEditor;
  const loaded = configuration.data !== undefined;
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
        help={<CurrentFeesHelp administrator={administrator} />}
        actions={
          administrator ? (
            <Group gap="xs" align="flex-start">
              <Button variant="light" onClick={onAddCompany}>
                Add company
              </Button>
              <Button
                variant="light"
                disabled={!loaded || configuration.isError || isSaving}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  feeEditor.addSku();
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
          {savedNotice ? "Refreshing saved settings…" : "Saving changes…"}
        </Text>
      ) : null}
      {configuration.isError ? (
        <ErrorAlert
          title="Could not load current fees"
          detail={loadErrorDetail(configuration.error)}
          retrying={configuration.isFetching}
          onRetry={() => void reloadSaved()}
        />
      ) : null}
      {savedNotice ? (
        <Alert role="status" color="green" mb="md">
          {savedNotice}
        </Alert>
      ) : null}
      {refreshFailed ? (
        <SavedSettingsAlert
          color="orange"
          title="Saved, but the list could not refresh"
          onRefresh={reloadSaved}
        />
      ) : null}
      {viewState.saveProblem && !reviewing ? (
        <SavedSettingsAlert
          color="red"
          title={viewState.saveProblem.title}
          refreshing={configuration.isFetching}
          onRefresh={reloadSaved}
        >
          {viewState.saveProblem.detail}
        </SavedSettingsAlert>
      ) : null}
      {loaded && nextIncompleteSku !== undefined ? (
        <NeedsSetupAlert
          count={issuesBySku.size}
          noun={["SKU", "SKUs"]}
          action={
            administrator
              ? {
                  label: "Complete next SKU",
                  disabled: isSaving,
                  onClick: () => {
                    editSku(nextIncompleteSku);
                  },
                }
              : undefined
          }
        />
      ) : null}
      {loaded && administrator ? (
        <FeeDraftStatus
          draftCount={drafts.length}
          unfinishedCount={viewState.editorDrafts.length}
          reviewDisabled={configuration.isError || isSaving}
          onResume={feeEditor.resumeEditor}
          onReview={() => {
            setReviewing(true);
          }}
        />
      ) : null}
      <SkuConfigurationList
        items={effectiveItems}
        loaded={loaded}
        companies={companies}
        issuesBySku={issuesBySku}
        administrator={administrator}
        onSelect={feeEditor.selectSku}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
      />
      <CurrentFeesDrawer
        {...{ identity, companies, savedItems, effectiveItems, issuesBySku, viewState, feeEditor }}
        loaded={loaded}
        isSaving={isSaving}
        onAddCompany={onAddCompany}
        onShowTransactions={onShowTransactions}
      />
      {administrator && loaded && reviewing ? (
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
          onDiscard={feeEditor.discardDraft}
          onShowIncomplete={feeEditor.showSetupIssues}
          onClose={() => {
            setReviewing(false);
          }}
        />
      ) : null}
    </div>
  );
}
