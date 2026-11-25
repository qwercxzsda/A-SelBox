import { useEffect, type RefObject } from "react";
import { useMutationState, useQueryClient, type MutationKey } from "@tanstack/react-query";
import { ApiError } from "./api";
import { saveError, type SaveError } from "./save-error";

export type MembershipFeedback =
  | { kind: "success"; message: string }
  | { kind: "error"; error: SaveError };

function knownReason(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 403) return "Only the database manager can change administrators.";
  if (error.status === 409) return "Access changed elsewhere. Review, then save again.";
  if (error.status === null || error.status >= 500)
    return "Could not confirm whether membership changed. Review it, then retry.";
  return undefined;
}

function membershipError(error: unknown): SaveError {
  return saveError("save the membership", error, knownReason(error));
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
        ? { kind: "error", error: membershipError(latestSave.error) }
        : {
            kind: "success",
            message: latestSave.revocation ? "Membership revoked" : "Membership saved",
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
