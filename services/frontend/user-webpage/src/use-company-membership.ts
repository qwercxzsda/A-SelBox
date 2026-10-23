import { useState, type RefObject } from "react";
import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { setCompanyMembership, type AppAccount, type Company } from "./api";
import type { PageResult } from "./api/types";
import { useWorkspacePreference } from "./use-workspace-preference";
import { isUuid } from "./api/validation";
import { useMountedRef } from "./use-mounted-ref";
import { useMembershipSaveFeedback, type MembershipFeedback } from "./use-membership-save-feedback";

interface MembershipOptions {
  accessToken: string;
  account: AppAccount;
  companies: Company[];
  onFeedbackChange: (feedback: MembershipFeedback | null) => void;
  observedSaveRef: RefObject<number | null>;
}

function isAccountQuery(query: Query): boolean {
  return (
    ["dataset", "dataset-count"].includes(String(query.queryKey[0])) &&
    query.queryKey[4] === "accounts"
  );
}

export function useCompanyMembership({
  accessToken,
  account,
  companies,
  onFeedbackChange,
  observedSaveRef,
}: MembershipOptions) {
  const client = useQueryClient();
  const mounted = useMountedRef();
  const mutationKey = ["company-membership", account.user_id];
  const { isSaving, observePendingSave } = useMembershipSaveFeedback({
    mutationKey,
    observedSaveRef,
    onFeedbackChange,
  });
  const [companyId, setCompanyId] = useWorkspacePreference<string | null>(
    `membership:${account.user_id}:${account.access_role}:${account.company_id ?? ""}`,
    () => account.company_id,
    (value) => (value === null || isUuid(value) ? value : account.company_id),
  );
  const [confirmRevocation, setConfirmRevocation] = useState(false);
  const mutation = useMutation({
    mutationKey,
    // Preserve a single immediate attempt; reconnecting must never replay a membership write.
    networkMode: "always",
    retry: false,
    mutationFn: (nextCompanyId: string | null) =>
      setCompanyMembership({
        accessToken,
        account,
        companyId: nextCompanyId,
      }),
    onSuccess: (updated) => {
      // Clear the original draft even after closing the editor, so a later
      // revocation cannot restore a company whose assignment already completed.
      setCompanyId(account.company_id);
      if (mounted.current) setConfirmRevocation(false);
      // Update cached roster pages before server verification, including after the drawer closes.
      client.setQueriesData<PageResult>(
        { predicate: (query) => isAccountQuery(query) && query.queryKey[0] === "dataset" },
        (page) =>
          page
            ? {
                ...page,
                rows: page.rows.map((entry) =>
                  entry.user_id === updated.user_id ? { ...entry, ...updated } : entry,
                ),
              }
            : page,
      );
    },
    onSettled: () => {
      // Even a failed response may have committed; verify before another change.
      return client.invalidateQueries({ predicate: isAccountQuery });
    },
  });

  function save(nextCompanyId: string | null) {
    if (client.isMutating({ mutationKey }) > 0) return;
    if (nextCompanyId !== null && !companies.some(({ id }) => id === nextCompanyId)) {
      onFeedbackChange({
        kind: "error",
        message: "This company is no longer available. Choose another company.",
      });
      return;
    }
    onFeedbackChange(null);
    mutation.mutate(nextCompanyId);
    observePendingSave();
  }

  return {
    companyId,
    setCompanyId,
    isSaving,
    confirmRevocation,
    setConfirmRevocation,
    save,
  };
}
