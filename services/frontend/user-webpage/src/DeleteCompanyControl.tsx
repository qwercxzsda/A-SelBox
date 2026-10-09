import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { ApiError, CompanyDeletionBlockedError, type Company } from "./api";
import type { CompanyDeletionReason } from "./api/company-errors";
import { useCompanyDirectory } from "./company-directory-context";
import { useMountedRef } from "./use-mounted-ref";

const REASON_LABELS: Record<CompanyDeletionReason["code"], string> = {
  members: "Members",
  assigned_skus: "Assigned SKUs",
  terms_versions: "Fee versions (including history)",
  payout_reports: "Payout reports",
  payout_refreshes: "Payout refreshes",
  other_records: "Other linked records",
};

function deletionError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403)
    return "Only administrators can delete companies.";
  return "Could not confirm whether this company was deleted. Try again to check its status.";
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
  const [problem, setProblem] = useState<string | CompanyDeletionBlockedError | null>(null);
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
      // The row may already be collapsed or removed; announce from the surviving list.
      onDeleted(company, result.deleted);
    } catch (error) {
      if (mounted.current)
        setProblem(error instanceof CompanyDeletionBlockedError ? error : deletionError(error));
    } finally {
      pending.current = false;
    }
  }

  return confirming ? (
    <Paper withBorder p="md" component="section" aria-label={`Delete ${company.name}`}>
      <Stack gap="sm">
        <Text size="sm" fw={600} className="company-list-name">
          Permanently delete {company.name}?
        </Text>
        <Text size="sm" c="dimmed">
          Only companies without members, SKU assignments, fee versions, or payout records can be
          deleted. This cannot be undone.
        </Text>
        {problem instanceof CompanyDeletionBlockedError ? (
          <Alert color="red" role="alert" title="Company cannot be deleted">
            <Text size="sm">The company still has these linked records:</Text>
            <ul className="company-deletion-reasons">
              {problem.reasons.map(({ code, count }) => (
                <li key={code}>
                  {REASON_LABELS[code]}: {code === "other_records" ? "at least " : ""}
                  {count.toLocaleString("en-US")}
                </li>
              ))}
            </ul>
            <Text size="sm">No records were deleted or unassigned.</Text>
          </Alert>
        ) : problem ? (
          <Alert color="red" role="alert">
            {problem}
          </Alert>
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
