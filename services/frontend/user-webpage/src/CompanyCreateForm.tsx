import { useRef, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { ApiError, type Company } from "./api";
import { useCompanyDirectory } from "./company-directory-context";
import { useWorkspacePreference } from "./use-workspace-preference";
import { getErrorMessage } from "./view-model";
import { useMountedRef } from "./use-mounted-ref";

function creationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Only administrators can add companies.";
    if (error.status === null || error.status >= 500)
      return "Could not confirm whether the company was added. Try again with the same name; an existing company will be reused.";
  }
  return `Could not add company. ${getErrorMessage(error)}`;
}

export function CompanyCreateForm({
  returnLabel,
  onCreated,
}: {
  returnLabel: string | null;
  onCreated: (company: Company) => void;
}) {
  const { companies, canManage, create, isCreating, isMutating } = useCompanyDirectory();
  const [name, setName] = useWorkspacePreference(
    "company-create:name",
    () => "",
    (value) => (typeof value === "string" ? value.slice(0, 1000) : ""),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ companyId: string; message: string } | null>(null);
  const mounted = useMountedRef();
  const pending = useRef(false);
  if (!canManage) return null;

  async function submit() {
    if (isMutating || pending.current || !name.trim()) return;
    pending.current = true;
    setProblem(null);
    setNotice(null);
    try {
      const company = await create(name);
      if (!mounted.current) return;
      setName("");
      setNotice({
        companyId: company.id,
        message: `${company.created ? "Company added" : "Company already exists"}: ${company.name}`,
      });
      onCreated(company);
    } catch (error) {
      if (mounted.current) setProblem(creationError(error));
    } finally {
      pending.current = false;
    }
  }

  return (
    <Paper withBorder p="md" component="section" aria-label="Add company">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Add company
        </Title>
        <Text size="sm" c="dimmed">
          Create a company, then assign SKUs in Current fees or members in User access.
        </Text>
        <form
          aria-label="Create company"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Group gap="sm" align="flex-end" className="company-create-fields">
            <TextInput
              label="Company name"
              autoComplete="off"
              className="company-create-name"
              value={name}
              disabled={isMutating}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setProblem(null);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
              }}
            />
            <Button type="submit" loading={isCreating} disabled={isMutating || !name.trim()}>
              Create company
            </Button>
          </Group>
        </form>
        {problem ? (
          <Alert role="alert" color="red">
            {problem}
          </Alert>
        ) : null}
        {notice && companies.some(({ id }) => id === notice.companyId) ? (
          <Alert role="status" color="green" className="company-create-notice">
            <Text size="sm">{notice.message}</Text>
            <Text size="sm">
              {returnLabel
                ? `Return to ${returnLabel} and select this company to continue. Your existing draft is unchanged.`
                : "The company is now available in Current fees and User access."}
            </Text>
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
