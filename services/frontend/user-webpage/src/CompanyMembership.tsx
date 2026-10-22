import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Select, Stack, Text, Title } from "@mantine/core";
import type { CanonicalRow, Company } from "./api";
import { parseAppAccount } from "./api/workspace";
import { humanizeCode } from "./categories";
import { companyLabel } from "./view-model";
import { useCompanyMembership, type MembershipFeedback } from "./use-company-membership";

interface MembershipProps {
  accessToken: string;
  companies: Company[];
  row: CanonicalRow | null;
  onClose: () => void;
  onAddCompany?: () => void;
}

export function CompanyMembership({ row, ...props }: MembershipProps) {
  const [feedback, setFeedback] = useState<(MembershipFeedback & { userId: string }) | null>(null);
  const visibleFeedback = feedback?.userId === row?.user_id ? feedback : null;
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visibleFeedback) feedbackRef.current?.focus();
  }, [visibleFeedback]);
  return (
    <Drawer
      opened={row !== null}
      onClose={() => {
        setFeedback(null);
        props.onClose();
      }}
      position="right"
      size="lg"
      padding="lg"
      title="Company membership"
      closeButtonProps={{ "aria-label": "Close membership details" }}
    >
      {visibleFeedback ? (
        <Alert
          ref={feedbackRef}
          tabIndex={-1}
          color={visibleFeedback.kind === "error" ? "red" : "teal"}
          role={visibleFeedback.kind === "error" ? "alert" : "status"}
          mb="md"
        >
          {visibleFeedback.message}
        </Alert>
      ) : null}
      {row ? (
        <MembershipEditor
          key={`${row.user_id ?? ""}:${row.access_role ?? ""}:${row.company_id ?? ""}`}
          row={row}
          {...props}
          onFeedbackChange={(feedback) => {
            setFeedback(feedback === null ? null : { ...feedback, userId: row.user_id ?? "" });
          }}
        />
      ) : null}
    </Drawer>
  );
}

function MembershipEditor({
  row,
  accessToken,
  companies,
  onFeedbackChange,
  onAddCompany,
}: Omit<MembershipProps, "row"> & {
  row: CanonicalRow;
  onFeedbackChange: (feedback: MembershipFeedback | null) => void;
}) {
  const account = parseAppAccount(row, row.user_id ?? "");
  const { companyId, setCompanyId, isSaving, confirmRevocation, setConfirmRevocation, save } =
    useCompanyMembership({ accessToken, account, companies, onFeedbackChange });
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

  return (
    <Stack gap="lg">
      <div>
        <Title order={3} style={{ overflowWrap: "anywhere" }}>
          {row.email ?? "Email unavailable"}
        </Title>
        <Group mt="sm">
          <Badge
            color={administrator ? "blue" : account.access_role === "member" ? "teal" : "gray"}
            variant="light"
          >
            {humanizeCode(account.access_role)}
          </Badge>
          {account.access_role !== "unassigned" ? (
            <Text size="sm" c="dimmed">
              {administrator ? "All companies" : `Current company: ${label}`}
            </Text>
          ) : null}
        </Group>
      </div>
      {administrator ? (
        <Alert>Administrator access can only be changed by the database manager.</Alert>
      ) : (
        <>
          {row.email_confirmed === "false" || row.email_confirmed === "f" ? (
            <Alert color="orange">
              This user has not confirmed their email yet. They must confirm it before signing in.
            </Alert>
          ) : null}
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
              description="A member can access only their company's workspace."
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
              <Text size="sm" c="orange.9" role="status">
                Unsaved change. Current access stays the same until you save membership.
              </Text>
            ) : null}
          </Stack>
          {companies.length === 0 ? (
            <Text size="sm" c="dimmed">
              No companies are available. Add a company to assign membership.
            </Text>
          ) : null}
          {confirmRevocation ? (
            <Alert
              ref={confirmationRef}
              tabIndex={-1}
              color="orange"
              title="Revoke company membership?"
            >
              <Text size="sm">
                This user will lose access to {label} and become Unassigned. Their sign-in account
                will remain available.
              </Text>
              <Group mt="md">
                <Button color="red" loading={isSaving} onClick={() => void save(null)}>
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
                onClick={() => void save(companyId)}
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
      <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
        User ID: {account.user_id}
      </Text>
    </Stack>
  );
}
