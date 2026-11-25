import { useEffect, useRef } from "react";
import { Alert, Button, Fieldset, Group, Stack, Text, Textarea } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, setReferenceAssignment } from "./api";
import type { Assignment } from "./api/assignment-types";
import type { Identity } from "./auth-session";
import { newEditorDraft, type AssignmentEditorDraft } from "./assignments-view";
import { CompanyField } from "./CompanyField";
import { ErrorAlert } from "./ErrorAlert";
import { saveError } from "./save-error";
import { queryRevisionSources } from "./workspace-revisions";

function assignmentSaveError(error: unknown) {
  return saveError(
    "save the assignment",
    error,
    error instanceof ApiError && error.status === 409 ? "Assignment changed elsewhere." : undefined,
  );
}

/** Choose the company that bears this ID's charges; laid out like the Fee editor. */
export function AssignmentEditor({
  row,
  draft,
  identity,
  onDraftChange,
  onCancel,
  onAddCompany,
  onSaved,
}: {
  row: Assignment;
  draft: AssignmentEditorDraft;
  identity: Identity;
  onDraftChange: (draft: AssignmentEditorDraft) => void;
  onCancel: () => void;
  onAddCompany: () => void;
  onSaved: (companyId: string | null) => void;
}) {
  const client = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  // An opening drawer's focus trap honours data-autofocus; Edit inside an open drawer does not.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);
  const save = useMutation({
    mutationFn: () =>
      setReferenceAssignment(identity.session.access_token, row, {
        companyId: draft.companyId,
        memo: draft.memo,
        expectedVersionId: draft.expectedVersionId,
      }),
    // A conflict reloads the list, which shows the newer version for review.
    onError: () => client.invalidateQueries({ queryKey: ["assignments"] }),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => queryRevisionSources(query.queryKey).includes("fees"),
      });
      onSaved(draft.companyId);
    },
  });
  // Another administrator saved since editing started: saving now would overwrite that change.
  const stale = draft.expectedVersionId !== row.versionId;
  const changed = draft.companyId !== row.companyId;
  const suggested =
    row.companyId === null &&
    draft.companyId !== null &&
    draft.companyId === row.suggestedCompanyId;
  return (
    <form
      ref={form}
      className="editing-drawer-layout drawer-panel-enter"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && !stale) save.mutate();
      }}
    >
      <div className="editing-drawer-scroll">
        <Fieldset variant="unstyled" m={0} disabled={save.isPending}>
          <Stack gap="md" className="assignment-details">
            {stale ? (
              <Alert color="orange" role="alert" title="Assignment changed elsewhere">
                <Group justify="space-between" align="flex-start" gap="xs">
                  <Text size="sm" flex="1 1 16rem">
                    Your choice is kept.
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => {
                      save.reset();
                      onDraftChange(newEditorDraft(row));
                      // The alert and its button leave; continue at the company.
                      requestAnimationFrame(() => {
                        form.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
                      });
                    }}
                  >
                    Load latest
                  </Button>
                </Group>
              </Alert>
            ) : null}
            <Stack gap={4}>
              <CompanyField
                companies={identity.companies}
                value={draft.companyId ?? ""}
                emptyLabel="Unassigned"
                initialFocus
                error={undefined}
                onChange={(companyId) => {
                  onDraftChange({ ...draft, companyId });
                }}
                onAddCompany={onAddCompany}
              />
              {suggested ? (
                <Text size="sm" c="dimmed">
                  Suggested: all products belong to this company.
                </Text>
              ) : changed ? (
                <Text size="sm" c="var(--ui-status-warning-text)" role="status">
                  Unsaved change.
                </Text>
              ) : null}
            </Stack>
            <Textarea
              label="Reason (optional)"
              autosize
              minRows={2}
              value={draft.memo}
              onChange={(event) => {
                onDraftChange({ ...draft, memo: event.currentTarget.value });
              }}
            />
            {save.isError && !stale ? (
              <ErrorAlert mb={0} {...assignmentSaveError(save.error)} />
            ) : null}
          </Stack>
        </Fieldset>
      </div>
      <Group justify="space-between" className="editing-drawer-actions">
        <Button variant="default" disabled={save.isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!changed || stale} loading={save.isPending}>
          Save
        </Button>
      </Group>
    </form>
  );
}
