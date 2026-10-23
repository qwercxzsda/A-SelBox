import { useEffect, type RefObject } from "react";
import { useMutationState, useQueryClient, type MutationKey } from "@tanstack/react-query";
import { ApiError } from "./api";
import { getErrorMessage } from "./view-model";

export interface MembershipFeedback {
  kind: "success" | "error";
  message: string;
}

function membershipError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403)
      return "You cannot change this user's access. Only the database manager can change administrators.";
    if (error.status === 409)
      return "This user's access changed while you were editing. Review their current membership below before saving again.";
    if (error.status === null || error.status >= 500)
      return "Could not confirm whether membership changed. Review the current membership below before trying again.";
  }
  return `Could not save membership. ${getErrorMessage(error)}`;
}

/** Follow this user's pending save across editor remounts without replaying older results. */
export function useMembershipSaveFeedback({
  mutationKey,
  observedSaveRef,
  onFeedbackChange,
}: {
  mutationKey: MutationKey;
  observedSaveRef: RefObject<number | null>;
  onFeedbackChange: (feedback: MembershipFeedback | null) => void;
}) {
  const client = useQueryClient();
  const latestSave = useMutationState({
    filters: { mutationKey },
    select: (mutation) => ({
      id: mutation.mutationId,
      status: mutation.state.status,
      error: mutation.state.error,
      revocation: mutation.state.variables === null,
    }),
  }).at(-1);
  const isSaving = latestSave?.status === "pending";
  useEffect(() => {
    if (!latestSave) return;
    if (latestSave.status === "pending") {
      observedSaveRef.current = latestSave.id;
      return;
    }
    if (observedSaveRef.current !== latestSave.id) return;
    if (latestSave.status !== "success" && latestSave.status !== "error") return;
    observedSaveRef.current = null;
    onFeedbackChange(
      latestSave.status === "error"
        ? { kind: "error", message: membershipError(latestSave.error) }
        : {
            kind: "success",
            message: latestSave.revocation
              ? "Membership revoked. This user is now Unassigned."
              : "Company membership saved.",
          },
    );
  }, [latestSave, onFeedbackChange, observedSaveRef]);

  function observePendingSave() {
    observedSaveRef.current =
      client.getMutationCache().findAll({ mutationKey, status: "pending" }).at(-1)?.mutationId ??
      null;
  }

  return { isSaving, observePendingSave };
}
