import { useRef, type SetStateAction } from "react";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { createSkuDraft, newSkuItem, sameSkuDraft } from "./sku-configuration-form";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import type { FeeEditorState, FeeViewState, ViewStateProps } from "./workspace-view-state";

function editorKey(editor: FeeEditorState): string {
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
    opened: view.editing !== null || view.reviewing,
    fallbackRef: panelRef,
    restoreOnClose: true,
  });
  function editSku(sku: string) {
    rememberOpener();
    change((current) => {
      const paused = current.editorDrafts.find((editor) => !editor.isNew && editor.sku === sku);
      return {
        ...current,
        reviewing: false,
        editing: paused ?? {
          sku,
          isNew: false,
          form: structuredClone(baselineDraft(sku, savedItems, current.drafts)),
          submitError: null,
          rateChange: null,
        },
      };
    });
  }
  function addSku() {
    rememberOpener();
    change((current) => ({
      ...current,
      reviewing: false,
      editing: current.editorDrafts.find((editor) => editor.isNew) ?? {
        sku: "",
        isNew: true,
        form: createSkuDraft(newSkuItem("")),
        submitError: null,
        rateChange: null,
      },
    }));
  }
  function updateEditor(update: SetStateAction<FeeEditorState>) {
    change((current) => ({
      ...current,
      editing: current.editing
        ? typeof update === "function"
          ? update(current.editing)
          : update
        : null,
    }));
  }
  function resumeEditor() {
    if (view.editorDrafts.length === 0) return;
    const editor = view.editorDrafts[0];
    if (editor.isNew) addSku();
    else editSku(editor.sku);
  }
  function closeEditor(discard = false) {
    change((current) => {
      const editor = current.editing;
      if (!editor) return current;
      const baseline = baselineDraft(editor.sku, savedItems, current.drafts);
      const editorDrafts = current.editorDrafts.filter(
        (entry) => editorKey(entry) !== editorKey(editor),
      );
      if (!discard && (editor.rateChange !== null || !sameSkuDraft(editor.form, baseline)))
        editorDrafts.push(structuredClone(editor));
      return { ...current, editing: null, editorDrafts };
    });
  }
  function stage(draft: SkuConfigurationChange) {
    change((current) => ({
      ...current,
      drafts: [...current.drafts.filter((entry) => entry.sku !== draft.sku), draft],
      editorDrafts: current.editorDrafts.filter(
        (entry) => !current.editing || editorKey(entry) !== editorKey(current.editing),
      ),
      expanded: [...new Set([...current.expanded, draft.sku])],
      editing: null,
      savedNotice: null,
    }));
  }
  function setReviewing(reviewing: boolean) {
    if (reviewing) rememberOpener();
    change((current) => ({ ...current, reviewing }));
  }
  return {
    panelRef,
    editSku,
    addSku,
    updateEditor,
    resumeEditor,
    closeEditor,
    stage,
    setReviewing,
  };
}
