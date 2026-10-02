import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchSkuConfiguration,
  publishSkuConfiguration,
  SkuConfigurationError,
  type SkuConfigurationChange,
} from "./api";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import { clearSubmittedDrafts } from "./sku-configuration-form";

export function useSkuConfiguration(
  identity: Identity,
  onRetry: () => Promise<void>,
  viewState: FeeViewState,
  onViewStateChange: ViewStateProps<FeeViewState>["onViewStateChange"],
  enabled: boolean,
) {
  const mutationKey = [
    "publish-sku-configuration",
    identity.session.user.id,
    identity.account.access_role,
    identity.account.company_id,
  ];
  const configuration = useQuery({
    queryKey: [
      "sku-configuration",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
    ],
    queryFn: ({ signal }) => fetchSkuConfiguration(identity.session.access_token, signal),
    enabled,
  });
  async function reloadSaved() {
    const refreshed = await configuration.refetch();
    if (!refreshed.isError) {
      onViewStateChange((current) => ({
        ...current,
        requiresReload: false,
        saveProblem: null,
        refreshFailed: false,
      }));
    }
  }
  const save = useMutation({
    mutationKey,
    mutationFn: (submitted: { changes: SkuConfigurationChange[]; changeReason: string }) => {
      onViewStateChange((current) => ({ ...current, savePending: true, savedNotice: null }));
      return publishSkuConfiguration({
        accessToken: identity.session.access_token,
        changes: submitted.changes,
        changeReason: submitted.changeReason,
      });
    },
    retry: false,
    onSuccess: async (result, submitted) => {
      onViewStateChange((current) => ({
        ...current,
        drafts: clearSubmittedDrafts(current.drafts, submitted.changes),
        changeReason: current.changeReason === submitted.changeReason ? "" : current.changeReason,
        saveProblem: null,
        requiresReload: false,
        savePending: false,
        savedNotice: `${String(result.changed_count)} SKU ${result.changed_count === 1 ? "change" : "changes"} saved.`,
      }));
      try {
        await onRetry();
        const refreshed = await configuration.refetch();
        onViewStateChange((current) => ({ ...current, refreshFailed: refreshed.isError }));
      } catch {
        onViewStateChange((current) => ({ ...current, refreshFailed: true }));
      }
    },
    onError: (error) => {
      const mustReload =
        error instanceof SkuConfigurationError && ["conflict", "unconfirmed"].includes(error.kind);
      onViewStateChange((current) => ({
        ...current,
        saveProblem: getErrorMessage(error),
        requiresReload: mustReload,
        savePending: false,
      }));
      if (error instanceof SkuConfigurationError && error.kind === "incomplete")
        void configuration.refetch();
    },
  });
  return {
    configuration,
    save,
    isSaving: save.isPending,
    reloadSaved,
    savedNotice: viewState.savedNotice,
    refreshFailed: viewState.refreshFailed,
    clearNotice: () => {
      onViewStateChange((current) => ({ ...current, savedNotice: null }));
    },
  };
}
