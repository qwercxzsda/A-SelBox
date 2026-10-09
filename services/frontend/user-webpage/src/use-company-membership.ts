import { useRef, useState } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { ApiError, setCompanyMembership, type AppAccount, type Company } from "./api";
import type { PageResult } from "./api/types";
import { useWorkspacePreference } from "./use-workspace-preference";
import { getErrorMessage } from "./view-model";
import { isUuid } from "./api/validation";
import { useMountedRef } from "./use-mounted-ref";

interface MembershipOptions {
  accessToken: string;
  account: AppAccount;
  companies: Company[];
  onNoticeChange: (message: string | null) => void;
}

function isAccountQuery(query: Query): boolean {
  return (
    ["dataset", "dataset-count"].includes(String(query.queryKey[0])) &&
    query.queryKey[4] === "accounts"
  );
}

function membershipError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403)
    return "You cannot change this user's access. Only the database manager can change administrators.";
  if (error instanceof ApiError && error.status === 409)
    return "This user's access changed while you were editing. Close this panel and review their latest membership.";
  return `Could not save membership. ${getErrorMessage(error)}`;
}

export function useCompanyMembership({
  accessToken,
  account,
  companies,
  onNoticeChange,
}: MembershipOptions) {
  const client = useQueryClient();
  const mounted = useMountedRef();
  const saving = useRef(false);
  const [companyId, setCompanyId] = useWorkspacePreference<string | null>(
    `membership:${account.user_id}:${account.access_role}:${account.company_id ?? ""}`,
    () => account.company_id,
    (value) => (value === null || isUuid(value) ? value : account.company_id),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [confirmRevocation, setConfirmRevocation] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(nextCompanyId: string | null) {
    if (saving.current) return;
    if (nextCompanyId !== null && !companies.some(({ id }) => id === nextCompanyId)) {
      setProblem("This company is no longer available. Choose another company.");
      return;
    }
    saving.current = true;
    setIsSaving(true);
    setProblem(null);
    onNoticeChange(null);
    try {
      const updated = await setCompanyMembership({
        accessToken,
        account,
        companyId: nextCompanyId,
      });
      if (mounted.current) {
        // Clear the completed draft in this original membership scope. The new
        // scope initializes from the saved row; revisiting Unassigned after a
        // later revocation must not restore the company we just granted.
        setCompanyId(account.company_id);
        setConfirmRevocation(false);
        onNoticeChange(
          nextCompanyId === null
            ? "Membership revoked. This user is now Unassigned."
            : "Company membership saved.",
        );
      }
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
    } catch (error) {
      if (mounted.current) setProblem(membershipError(error));
    } finally {
      // Even a failed response may have committed; verify before another change.
      await client.invalidateQueries({ predicate: isAccountQuery });
      saving.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }

  return {
    companyId,
    setCompanyId,
    isSaving,
    confirmRevocation,
    setConfirmRevocation,
    problem,
    save,
  };
}
