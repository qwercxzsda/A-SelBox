import { useRef, useState } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { ApiError, type Company } from "./api";
import { useCompanyDirectory } from "./company-directory-context";
import { useWorkspacePreference } from "./use-workspace-preference";
import { getErrorMessage } from "./view-model";
import { useMountedRef } from "./use-mounted-ref";
import { useActionFeedbackFocus } from "./use-action-feedback-focus";

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
  const visibleNotice =
    notice && companies.some(({ id }) => id === notice.companyId) ? notice : null;
  const sectionRef = useRef<HTMLElement>(null);
  const feedbackRef = useActionFeedbackFocus(problem ?? visibleNotice?.message ?? null, sectionRef);
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
    <section ref={sectionRef} aria-label="Add company">
      <Stack gap="sm">
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
              data-autofocus
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
          <Alert ref={feedbackRef} tabIndex={-1} role="alert" color="red">
            {problem}
          </Alert>
        ) : null}
        {visibleNotice ? (
          <Alert
            ref={feedbackRef}
            tabIndex={-1}
            role="status"
            color="green"
            className="company-create-notice"
          >
            <Text size="sm">{visibleNotice.message}</Text>
            <Text size="sm">
              {returnLabel
                ? `Return to ${returnLabel} and select this company to continue. Your existing draft is unchanged.`
                : "The company is now available in Current fees and User access."}
            </Text>
          </Alert>
        ) : null}
      </Stack>
    </section>
  );
}
