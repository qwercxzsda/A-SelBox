import type { Dispatch, SetStateAction } from "react";
import { useForm } from "@mantine/form";
import type { SkuConfigurationChange } from "./api";
import type { FeeEditorState } from "./workspace-view-state";
import { sameFeePeriods } from "./sku-configuration-form";

export function useSkuEditorForm(
  editing: FeeEditorState,
  onEditingChange: Dispatch<SetStateAction<FeeEditorState>>,
) {
  const form = useForm<SkuConfigurationChange>({
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
          current.rateChange && !sameFeePeriods(values.periods, previous.periods)
            ? { ...current.rateChange, previewRequested: false }
            : current.rateChange,
      }));
    },
  });

  function setRateChange(rateChange: FeeEditorState["rateChange"]) {
    onEditingChange((current) => ({ ...current, rateChange }));
  }

  function replaceDraft(draft: SkuConfigurationChange) {
    setRateChange(null);
    form.setValues(draft);
  }

  function startRateChange(periodIndex: number) {
    onEditingChange((current) => {
      if (current.rateChange) return current;
      return {
        ...current,
        rateChange: {
          periodIndex,
          effectiveDate: "",
          feeRatePercent: "",
          previewRequested: false,
        },
      };
    });
  }

  function removePeriod(index: number) {
    onEditingChange((current) => {
      const rateChange = current.rateChange;
      if (!rateChange) return current;
      return {
        ...current,
        rateChange:
          index === rateChange.periodIndex
            ? null
            : {
                ...rateChange,
                periodIndex:
                  index < rateChange.periodIndex
                    ? rateChange.periodIndex - 1
                    : rateChange.periodIndex,
              },
      };
    });
    form.removeListItem("periods", index);
  }

  return { form, replaceDraft, startRateChange, setRateChange, removePeriod };
}
