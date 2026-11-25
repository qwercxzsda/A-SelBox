import { useEffect, useRef, useState, type RefObject } from "react";
import { Alert, Button, Group, Select, Stack, Text } from "@mantine/core";
import type { CanonicalRow, Company } from "./api";
import { parseAppAccount } from "./api/workspace";
import { parseCsvBoolean } from "./api/csv-boolean";
import { humanizeCode } from "./categories";
import { companyLabel } from "./view-model";
import { useCompanyMembership } from "./use-company-membership";
import type { MembershipFeedback } from "./use-membership-save-feedback";
import type { SaveError } from "./save-error";
import { ErrorAlert } from "./ErrorAlert";
import { AdditionalDetails } from "./AdditionalDetails";
import { DetailDrawer } from "./DetailDrawer";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { formatRecordDate } from "./date-display";
import "./CompanyMembership.css";

const ROLE_TONES: Record<string, StatusTone> = {
  administrator: "info",
  member: "success",
  unassigned: "neutral",
};

interface MembershipProps {
  accessToken: string;
  companies: Company[];
  row: CanonicalRow | null;
  onClose: () => void;
  /** A successful save closes the drawer; the page names the saved account. */
  onSaved: (notice: string) => void;
  onAddCompany?: () => void;
}

function accessScope(row: CanonicalRow, companies: Company[]) {
  if (row.access_role === "administrator") return "All companies";
  return companyLabel(row.company_id, new Map(companies.map(({ id, name }) => [id, name])));
}

export function CompanyMembership({ row, onSaved, ...props }: MembershipProps) {
  const [problem, setProblem] = useState<{ userId: string; error: SaveError } | null>(null);
  const visibleProblem = problem?.userId === row?.user_id ? problem : null;
  const problemRef = useRef<HTMLDivElement>(null);
  // Updated access remounts the editor; keep its pending result tied to this drawer.
  const observedSaveRef = useRef<number | null>(null);
  // A drawer restored on reload has no opener, so a save returns focus to the account's row itself.
  const savedRowRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (visibleProblem) problemRef.current?.focus();
  }, [visibleProblem]);
  return (
    <DetailDrawer
      opened={row !== null}
      onClose={() => {
        // A save still pending is reported only if this account is reopened before it settles.
        observedSaveRef.current = null;
        setProblem(null);
        props.onClose();
      }}
      onExitTransitionEnd={() => {
        savedRowRef.current?.focus({ preventScroll: true });
        savedRowRef.current = null;
      }}
      width="record"
      title="User access details"
      context={
        row ? `${row.email ?? "Email unavailable"} · ${accessScope(row, props.companies)}` : ""
      }
    >
      {visibleProblem ? <ErrorAlert ref={problemRef} {...visibleProblem.error} /> : null}
      {row ? (
        <MembershipEditor
          key={`${row.user_id ?? ""}:${row.access_role ?? ""}:${row.company_id ?? ""}`}
          row={row}
          observedSaveRef={observedSaveRef}
          {...props}
          onFeedbackChange={(feedback: MembershipFeedback | null) => {
            if (feedback?.kind === "success") {
              savedRowRef.current = document.querySelector<HTMLElement>(
                '[aria-label="User accounts"] .inspectable-row[aria-selected="true"]',
              );
              setProblem(null);
              onSaved(`${feedback.message}: ${row.email ?? row.user_id ?? ""}`);
            } else setProblem(feedback && { userId: row.user_id ?? "", error: feedback.error });
          }}
        />
      ) : null}
    </DetailDrawer>
  );
}

function MembershipEditor({
  row,
  accessToken,
  companies,
  onFeedbackChange,
  onAddCompany,
  observedSaveRef,
}: Omit<MembershipProps, "row" | "onSaved"> & {
  row: CanonicalRow;
  onFeedbackChange: (feedback: MembershipFeedback | null) => void;
  observedSaveRef: RefObject<number | null>;
}) {
  const account = parseAppAccount(row, row.user_id ?? "");
  const { companyId, setCompanyId, isSaving, confirmRevocation, setConfirmRevocation, save } =
    useCompanyMembership({ accessToken, account, companies, onFeedbackChange, observedSaveRef });
  const confirmationRef = useRef<HTMLDivElement>(null);
  const revokeButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRevocation = useRef(false);
  useEffect(() => {
    if (confirmRevocation) confirmationRef.current?.focus();
    else if (wasConfirmingRevocation.current) revokeButtonRef.current?.focus();
    wasConfirmingRevocation.current = confirmRevocation;
  }, [confirmRevocation]);
  const administrator = account.access_role === "administrator";
  const unavailableCompany = companyId !== null && !companies.some(({ id }) => id === companyId);
  const label = companyLabel(
    account.company_id,
    new Map(companies.map(({ id, name }) => [id, name])),
  );
  const emailConfirmed = parseCsvBoolean(row.email_confirmed, "email_confirmed");

  return (
    <>
      <Stack gap="lg" className="company-membership-content">
        <StatusBadge tone={ROLE_TONES[account.access_role] ?? "neutral"}>
          {humanizeCode(account.access_role)}
        </StatusBadge>
        {administrator ? (
          <Alert>Administrator access can only be changed by the database manager.</Alert>
        ) : (
          <>
            {emailConfirmed ? null : (
              <Alert color="orange">Email not confirmed. They can't sign in yet.</Alert>
            )}
            <Stack gap={4}>
              <Group justify="space-between" align="flex-start" gap="xs">
                <Text className="ui-input-label">Company</Text>
                {onAddCompany ? (
                  <Button
                    type="button"
                    variant="subtle"
                    size="compact-sm"
                    disabled={isSaving || confirmRevocation}
                    onClick={onAddCompany}
                  >
                    Add company
                  </Button>
                ) : null}
              </Group>
              <Select
                aria-label="Company"
                placeholder="Select a company"
                searchable
                data={companies.map(({ id, name }) => ({ value: id, label: name }))}
                value={unavailableCompany ? null : companyId}
                onChange={setCompanyId}
                disabled={isSaving || confirmRevocation}
                nothingFoundMessage="No matching companies"
                error={
                  unavailableCompany
                    ? "This company is no longer available. Choose another company."
                    : undefined
                }
              />
              {companyId !== account.company_id ? (
                <Text size="sm" c="var(--ui-status-warning-text)" role="status">
                  Unsaved change.
                </Text>
              ) : null}
            </Stack>
            {companies.length === 0 ? (
              <Text size="sm" c="dimmed">
                No companies yet. Add one first.
              </Text>
            ) : null}
            {confirmRevocation ? (
              <Alert
                ref={confirmationRef}
                tabIndex={-1}
                color="orange"
                title="Revoke company membership?"
              >
                <Text size="sm">This user loses access to {label}.</Text>
                <Group mt="md">
                  <Button
                    color="red"
                    loading={isSaving}
                    onClick={() => {
                      save(null);
                    }}
                  >
                    Confirm revocation
                  </Button>
                  <Button
                    variant="default"
                    disabled={isSaving}
                    onClick={() => {
                      setConfirmRevocation(false);
                    }}
                  >
                    Keep membership
                  </Button>
                </Group>
              </Alert>
            ) : (
              <Group justify="space-between">
                <Button
                  loading={isSaving}
                  disabled={!companyId || unavailableCompany || companyId === account.company_id}
                  onClick={() => {
                    save(companyId);
                  }}
                >
                  Save membership
                </Button>
                {account.access_role === "member" ? (
                  <Button
                    ref={revokeButtonRef}
                    color="red"
                    variant="light"
                    disabled={isSaving}
                    onClick={() => {
                      setConfirmRevocation(true);
                    }}
                  >
                    Revoke membership
                  </Button>
                ) : null}
              </Group>
            )}
          </>
        )}
      </Stack>
      <AdditionalDetails
        stateKey={`row:accounts:${account.user_id}:metadata`}
        rows={[
          { field: "User ID", value: account.user_id },
          { field: "Company ID", value: account.company_id },
          {
            field: "Joined (UTC)",
            value: row.created_at
              ? formatRecordDate(row.created_at, { includeTimeZone: false })
              : null,
          },
          { field: "Email confirmed", value: emailConfirmed ? "Yes" : "No" },
        ]}
      />
    </>
  );
}
