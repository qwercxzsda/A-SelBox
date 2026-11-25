import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { AlertTable } from "./AlertTable";
import { ApiError, CompanyDeletionBlockedError, type Company } from "./api";
import type { CompanyDeletionReason } from "./api/company-errors";
import { useCompanyDirectory } from "./company-directory-context";
import { useMountedRef } from "./use-mounted-ref";
import { useActionFeedbackFocus } from "./use-action-feedback-focus";
import { ErrorAlert } from "./ErrorAlert";
import { saveError, saveErrorText, type SaveError } from "./save-error";

const REASON_LABELS: Record<CompanyDeletionReason["code"], string> = {
  members: "Members",
  assigned_skus: "Assigned SKUs",
  terms_versions: "Fee versions (including history)",
  payout_reports: "Payout reports",
  payout_refreshes: "Payout refreshes",
  other_records: "Other linked records",
};
const REASON_ORDER = Object.keys(REASON_LABELS);
const BLOCKER_COLUMNS = [
  {
    key: "record",
    label: "Linked record",
    value: ({ code }: CompanyDeletionReason) => REASON_LABELS[code],
  },
  {
    key: "count",
    label: "Count",
    // An unnamed foreign key reports only that at least one record links to the company.
    value: ({ code, count }: CompanyDeletionReason) =>
      `${code === "other_records" ? "At least " : ""}${count.toLocaleString("en-US")}`,
  },
] as const;

function deletionError(error: unknown): SaveError {
  return saveError(
    "delete the company",
    error,
    error instanceof ApiError && error.status === 403
      ? "Only administrators can delete companies."
      : "Could not confirm the deletion. Retry to check.",
  );
}

export function DeleteCompanyControl({
  company,
  onDeleted,
}: {
  company: Company;
  onDeleted: (company: Company, deleted: boolean) => void;
}) {
  const { canManage, isMutating, deletingId, remove } = useCompanyDirectory();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<SaveError | CompanyDeletionBlockedError | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const feedbackRef = useActionFeedbackFocus(
    problem instanceof CompanyDeletionBlockedError
      ? problem.message
      : problem && saveErrorText(problem),
    sectionRef,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useMountedRef();
  const pending = useRef(false);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);
  if (!canManage) return null;

  async function submit() {
    if (pending.current || isMutating) return;
    pending.current = true;
    setProblem(null);
    try {
      const result = await remove(company.id);
      // The details may already be closed; announce from the surviving list.
      onDeleted(company, result.deleted);
    } catch (error) {
      if (mounted.current)
        setProblem(error instanceof CompanyDeletionBlockedError ? error : deletionError(error));
    } finally {
      pending.current = false;
    }
  }

  return confirming ? (
    <Paper
      ref={sectionRef}
      withBorder
      p="md"
      component="section"
      aria-label={`Delete ${company.name}`}
    >
      <Stack gap="sm">
        <Text size="sm" fw={600} className="company-list-name">
          Permanently delete {company.name}?
        </Text>
        <Text size="sm" c="dimmed">
          This cannot be undone.
        </Text>
        {problem instanceof CompanyDeletionBlockedError ? (
          <Alert
            ref={feedbackRef}
            tabIndex={-1}
            color="red"
            role="alert"
            title="Company cannot be deleted"
          >
            <Stack gap="xs">
              <Text size="sm">Linked records remain. Nothing was deleted.</Text>
              <AlertTable
                label={`Linked records of ${company.name}`}
                columns={BLOCKER_COLUMNS}
                rows={problem.reasons.toSorted(
                  (left, right) =>
                    REASON_ORDER.indexOf(left.code) - REASON_ORDER.indexOf(right.code),
                )}
                rowKey={({ code }) => code}
              />
            </Stack>
          </Alert>
        ) : problem ? (
          <ErrorAlert ref={feedbackRef} mb={0} {...problem} />
        ) : null}
        <Group gap="sm">
          <Button
            color="red"
            loading={deletingId === company.id}
            disabled={isMutating}
            onClick={() => {
              void submit();
            }}
          >
            Delete permanently
          </Button>
          <Button
            ref={cancel}
            variant="default"
            disabled={deletingId === company.id}
            onClick={() => {
              setConfirming(false);
              setProblem(null);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          >
            Cancel
          </Button>
        </Group>
      </Stack>
    </Paper>
  ) : (
    <Button
      ref={trigger}
      color="red"
      variant="light"
      w="fit-content"
      disabled={isMutating}
      onClick={() => {
        setConfirming(true);
      }}
    >
      Delete company
    </Button>
  );
}
