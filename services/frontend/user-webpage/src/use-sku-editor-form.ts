import type { Dispatch, SetStateAction } from "react";
import { useForm } from "@mantine/form";
import type { SkuConfigurationChange } from "./api";
import type { FeeEditorState } from "./workspace-view-state";

export function useSkuEditorForm(
  editing: FeeEditorState,
  onEditingChange: Dispatch<SetStateAction<FeeEditorState>>,
) {
  return useForm<SkuConfigurationChange>({
    mode: "controlled",
    initialValues: editing.form,
    // The workspace stores a checkpoint on every edit. It initializes this form
    // when reopened; copying checkpoints back into the live form would reset edits.
    onValuesChange: (values, previous) => {
      onEditingChange((current) => ({
        ...current,
        form: values,
        submitError: values.sku === previous.sku ? current.submitError : null,
        // Mantine clones nested values, including for unrelated field changes.
        // Only changed periods invalidate an existing rate-change preview.
        rateChange:
          current.rateChange && JSON.stringify(values.periods) !== JSON.stringify(previous.periods)
            ? { ...current.rateChange, previewRequested: false }
            : current.rateChange,
      }));
    },
  });
}
