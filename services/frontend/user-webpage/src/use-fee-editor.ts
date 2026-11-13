import { useRef, type SetStateAction } from "react";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { createSkuDraft, newSkuItem, sameSkuDraft } from "./sku-configuration-form";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import type { FeeEditorState, FeeViewState, ViewStateProps } from "./workspace-view-state";

function editorKey(editor: Pick<FeeEditorState, "sku" | "isNew">): string {
  return editor.isNew ? "new" : `sku:${editor.sku}`;
}

function baselineDraft(
  sku: string,
  savedItems: SkuConfigurationItem[],
  drafts: SkuConfigurationChange[],
): SkuConfigurationChange {
  return (
    drafts.find((draft) => draft.sku === sku) ??
    createSkuDraft(savedItems.find((item) => item.sku === sku) ?? newSkuItem(sku))
  );
}

export function useFeeEditor(
  savedItems: SkuConfigurationItem[],
  view: FeeViewState,
  change: ViewStateProps<FeeViewState>["onViewStateChange"],
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { rememberOpener } = useDrawerFocusReturn({
    opened: view.selectedSku !== null || view.editing !== null || view.reviewing,
    fallbackRef: panelRef,
    restoreOnClose: true,
  });
  function selectSku(selectedSku: string) {
    rememberOpener();
    change((current) => ({ ...current, selectedSku, reviewing: false }));
  }
  function closeDetails() {
    change((current) => ({ ...current, selectedSku: null }));
  }
  function openEditor(sku: string, isNew: boolean) {
    rememberOpener();
    change((current) => {
      const key = editorKey({ sku, isNew });
      const paused = current.editorDrafts.find((editor) => editorKey(editor) === key);
      return {
        ...current,
        selectedSku: isNew ? null : sku,
        reviewing: false,
        editing: paused ?? {
          sku,
          isNew,
          form: structuredClone(
            isNew ? createSkuDraft(newSkuItem()) : baselineDraft(sku, savedItems, current.drafts),
          ),
          submitError: null,
          rateChange: null,
        },
      };
    });
  }
  function updateEditor(update: SetStateAction<FeeEditorState>) {
    change((current) => {
      if (!current.editing) return current;
      return {
        ...current,
        editing: typeof update === "function" ? update(current.editing) : update,
      };
    });
  }
  function resumeEditor() {
    const editor = view.editorDrafts.at(0);
    if (editor) openEditor(editor.sku, editor.isNew);
  }
  function finishEditing({ discard = false, returnToDetails = false } = {}) {
    change((current) => {
      const editor = current.editing;
      if (!editor) return current;
      const baseline = baselineDraft(editor.sku, savedItems, current.drafts);
      const editorDrafts = current.editorDrafts.filter(
        (entry) => editorKey(entry) !== editorKey(editor),
      );
      if (!discard && (editor.rateChange !== null || !sameSkuDraft(editor.form, baseline)))
        editorDrafts.push(structuredClone(editor));
      return {
        ...current,
        selectedSku: returnToDetails && !editor.isNew ? editor.sku : null,
        editing: null,
        editorDrafts,
      };
    });
  }
  function stage(draft: SkuConfigurationChange) {
    change((current) => ({
      ...current,
      drafts: [...current.drafts.filter((entry) => entry.sku !== draft.sku), draft],
      editorDrafts: current.editorDrafts.filter(
        (entry) => !current.editing || editorKey(entry) !== editorKey(current.editing),
      ),
      selectedSku: null,
      editing: null,
      savedNotice: null,
    }));
  }
  function discardDraft(sku: string) {
    change((current) => ({
      ...current,
      drafts: current.drafts.filter((draft) => draft.sku !== sku),
      selectedSku:
        current.selectedSku === sku && !savedItems.some((item) => item.sku === sku)
          ? null
          : current.selectedSku,
    }));
  }
  function showSetupIssues() {
    change((current) => ({
      ...current,
      reviewing: false,
      statuses: ["needs-setup"],
      skus: [],
      companyIds: [],
      marketplaces: [],
      search: "",
      pageIndex: 0,
    }));
  }
  function setReviewing(reviewing: boolean) {
    if (reviewing) rememberOpener();
    change((current) => ({
      ...current,
      selectedSku: reviewing ? null : current.selectedSku,
      reviewing,
    }));
  }
  return {
    panelRef,
    selectSku,
    closeDetails,
    backToDetails: () => {
      finishEditing({ returnToDetails: true });
    },
    editSku: (sku: string) => {
      openEditor(sku, false);
    },
    addSku: () => {
      openEditor("", true);
    },
    updateEditor,
    resumeEditor,
    closeEditor: () => {
      finishEditing();
    },
    discardEdits: () => {
      finishEditing({ discard: true });
    },
    discardDraft,
    showSetupIssues,
    stage,
    setReviewing,
  };
}
