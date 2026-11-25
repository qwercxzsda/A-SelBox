import { Button, Group, NativeSelect, Stack, Text } from "@mantine/core";
import type { Company } from "./api";

/**
 * The company choice in the fee and assignment editors; "Add company" sits beside the label,
 * never inside it.
 */
export function CompanyField({
  companies,
  value,
  emptyLabel,
  initialFocus,
  error,
  onChange,
  onAddCompany,
}: {
  companies: Company[];
  /** A company ID, or "" when none is chosen. */
  value: string;
  emptyLabel: string;
  /** Marks the select for the editor's opening focus. */
  initialFocus: boolean;
  error: string | undefined;
  onChange: (companyId: string | null) => void;
  onAddCompany: () => void;
}) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="flex-start" gap="xs">
        <Text className="ui-input-label">Company</Text>
        <Button type="button" variant="subtle" size="compact-sm" onClick={onAddCompany}>
          Add company
        </Button>
      </Group>
      <NativeSelect
        aria-label="Company"
        data-autofocus={initialFocus || undefined}
        value={value}
        data={[
          { value: "", label: emptyLabel },
          ...companies.map((company) => ({ value: company.id, label: company.name })),
        ]}
        onChange={(event) => {
          onChange(event.currentTarget.value || null);
        }}
        error={error}
      />
    </Stack>
  );
}
