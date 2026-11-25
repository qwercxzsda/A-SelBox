import { useRef } from "react";
import { Button } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import type { Identity } from "./auth-session";
import { DetailDrawer } from "./DetailDrawer";
import { SkuConfigurationDetails } from "./SkuConfigurationDetails";
import { SkuConfigurationEditor } from "./SkuConfigurationEditor";
import { SkuFeeSchedules } from "./SkuFeeSchedules";
import { newSkuItem, type SkuFormIssue } from "./sku-configuration-form";
import type { useFeeEditor } from "./use-fee-editor";
import { companyLabel } from "./view-model";
import type { FeeEditorState, FeeViewState } from "./workspace-view-state";
import "./EditingDrawer.css";

/** "SKU · company" for a saved SKU, "SKU · New SKU" while adding one. */
function feeEditorContext(
  editing: FeeEditorState,
  savedItems: readonly SkuConfigurationItem[],
  companies: Map<string, string>,
) {
  const saved = savedItems.find((item) => item.sku === editing.sku);
  const scope = editing.isNew || !saved ? "New SKU" : companyLabel(saved.company_id, companies);
  return editing.sku ? `${editing.sku} · ${scope}` : scope;
}

/** Fee details of the selected SKU, swapped for the fee editor while an administrator edits. */
export function CurrentFeesDrawer({
  identity,
  companies,
  savedItems,
  effectiveItems,
  issuesBySku,
  viewState,
  feeEditor,
  loaded,
  isSaving,
  onAddCompany,
  onShowTransactions,
}: {
  identity: Identity;
  companies: Map<string, string>;
  savedItems: SkuConfigurationItem[];
  effectiveItems: SkuConfigurationItem[];
  issuesBySku: Map<string, SkuFormIssue[]>;
  viewState: FeeViewState;
  feeEditor: ReturnType<typeof useFeeEditor>;
  loaded: boolean;
  isSaving: boolean;
  onAddCompany: () => void;
  onShowTransactions: (sku: string) => void;
}) {
  const administrator = identity.account.access_role === "administrator";
  const { drafts, editing, selectedSku } = viewState;
  const { closeDetails, closeEditor, editSku } = feeEditor;
  const editorItem =
    administrator && editing
      ? (savedItems.find((item) => item.sku === editing.sku) ?? newSkuItem(editing.sku))
      : null;
  const selectedItem = effectiveItems.find((item) => item.sku === selectedSku) ?? null;
  const selectedSavedItem = savedItems.find((item) => item.sku === selectedSku) ?? null;
  const selectedHasDraft = administrator && drafts.some((draft) => draft.sku === selectedSku);
  const editButton = useRef<HTMLButtonElement>(null);
  const editAction =
    administrator && !editing && selectedItem ? (
      <Button
        ref={editButton}
        size="xs"
        aria-label={`Edit ${selectedItem.sku}`}
        disabled={isSaving}
        onClick={() => {
          editSku(selectedItem.sku);
        }}
      >
        Edit
      </Button>
    ) : undefined;
  return (
    <DetailDrawer
      opened={loaded && Boolean(editorItem ?? selectedItem)}
      title={editing ? "Fee editor" : "Fee details"}
      context={
        editing
          ? feeEditorContext(editing, savedItems, companies)
          : selectedItem
            ? `${selectedItem.sku} · ${companyLabel(selectedItem.company_id, companies)}`
            : ""
      }
      width="wide"
      headerActions={editAction}
      classNames={{
        content: "editing-drawer-content",
        body: "editing-drawer-body",
      }}
      onClose={editing ? closeEditor : closeDetails}
    >
      {loaded && editorItem && editing ? (
        <SkuConfigurationEditor
          key={editing.sku}
          item={editorItem}
          editing={editing}
          onEditingChange={feeEditor.updateEditor}
          companies={identity.companies}
          knownSkus={effectiveItems.map((item) => item.sku)}
          onEditExisting={editSku}
          onDiscard={feeEditor.discardEdits}
          onStage={feeEditor.stage}
          onAddCompany={onAddCompany}
          onBackToDetails={feeEditor.backToDetails}
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
          editButtonRef={editButton}
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
          hasUnfinishedEdit={viewState.editorDrafts.some((draft) => draft.sku === selectedItem.sku)}
          onDiscardDraft={() => {
            feeEditor.discardDraft(selectedItem.sku);
          }}
          onShowTransactions={(sku) => {
            closeDetails();
            onShowTransactions(sku);
          }}
        />
      ) : null}
    </DetailDrawer>
  );
}
