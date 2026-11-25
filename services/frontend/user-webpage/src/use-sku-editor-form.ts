import type { Dispatch, SetStateAction } from "react";
import { useForm } from "@mantine/form";
import type { SkuConfigurationChange } from "./api";
import type { FeeEditorState } from "./workspace-view-state";
import { movePeriodPaths, sameFeePeriods } from "./sku-configuration-form";

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

  /** Starts over from a draft: no rate change and no visited fields. */
  function loadDraft(draft: SkuConfigurationChange) {
    onEditingChange((current) => ({ ...current, rateChange: null, visited: [] }));
    form.setValues(draft);
  }

  /** Applies a rate change that split or replaced period `periodIndex`. */
  function applyRateChange(periodIndex: number, periods: SkuConfigurationChange["periods"]) {
    onEditingChange((current) => ({
      ...current,
      rateChange: null,
      visited: movePeriodPaths(
        current.visited,
        periodIndex + 1,
        periods.length - current.form.periods.length,
      ),
    }));
    form.setValues({ ...form.getValues(), periods });
  }

  function visit(path: string) {
    onEditingChange((current) =>
      current.visited.includes(path)
        ? current
        : { ...current, visited: [...current.visited, path] },
    );
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
      return {
        ...current,
        visited: movePeriodPaths(current.visited, index, -1),
        rateChange:
          !rateChange || index === rateChange.periodIndex
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

  return {
    form,
    loadDraft,
    applyRateChange,
    visit,
    startRateChange,
    setRateChange,
    removePeriod,
  };
}
