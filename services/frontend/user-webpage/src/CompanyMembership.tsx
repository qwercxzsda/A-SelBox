import { useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Select, Stack, Text, Title } from "@mantine/core";
import type { CanonicalRow, Company } from "./api";
import { parseAppAccount } from "./api/workspace";
import { humanizeCode } from "./categories";
import { companyLabel } from "./view-model";
import { useCompanyMembership } from "./use-company-membership";

interface MembershipProps {
  accessToken: string;
  companies: Company[];
  row: CanonicalRow | null;
  onClose: () => void;
  onAddCompany?: () => void;
}

export function CompanyMembership({ row, ...props }: MembershipProps) {
  const [notice, setNotice] = useState<{ userId: string; message: string } | null>(null);
  return (
    <Drawer
      opened={row !== null}
      onClose={() => {
        setNotice(null);
        props.onClose();
      }}
      position="right"
      size="lg"
      padding="lg"
      title="Company membership"
      closeButtonProps={{ "aria-label": "Close membership details" }}
    >
      {notice && notice.userId === row?.user_id ? (
        <Alert color="teal" role="status" mb="md">
          {notice.message}
        </Alert>
      ) : null}
      {row ? (
        <MembershipEditor
          key={`${row.user_id ?? ""}:${row.access_role ?? ""}:${row.company_id ?? ""}`}
          row={row}
          {...props}
          onNoticeChange={(message) => {
            setNotice(message === null ? null : { userId: row.user_id ?? "", message });
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
  onNoticeChange,
  onAddCompany,
}: Omit<MembershipProps, "row"> & {
  row: CanonicalRow;
  onNoticeChange: (message: string | null) => void;
}) {
  const account = parseAppAccount(row, row.user_id ?? "");
  const {
    companyId,
    setCompanyId,
    isSaving,
    confirmRevocation,
    setConfirmRevocation,
    problem,
    save,
  } = useCompanyMembership({ accessToken, account, companies, onNoticeChange });
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
              {administrator ? "All companies" : label}
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
          </Stack>
          {companies.length === 0 ? (
            <Text size="sm" c="dimmed">
              No companies are available. Add a company to assign membership.
            </Text>
          ) : null}
          {problem ? (
            <Alert color="red" role="alert">
              {problem}
            </Alert>
          ) : null}
          {confirmRevocation ? (
            <Alert color="orange" title="Revoke company membership?">
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
