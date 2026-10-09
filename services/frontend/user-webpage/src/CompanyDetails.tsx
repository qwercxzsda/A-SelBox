import { Button, Group, Stack, Text } from "@mantine/core";
import type { Company } from "./api";
import { DeleteCompanyControl } from "./DeleteCompanyControl";
import { SkuTransactionLink } from "./SkuTransactionLink";

export function CompanyDetails({
  company,
  skus,
  onDeleted,
  onShowMembers,
  onShowTransactions,
}: {
  company: Company;
  skus: string[];
  onDeleted: (company: Company, deleted: boolean) => void;
  onShowMembers: (companyId: string) => void;
  onShowTransactions: (sku: string) => void;
}) {
  return (
    <Stack gap="md" className="company-details">
      <Group justify="space-between" align="flex-start" gap="sm">
        <div className="company-details-id">
          <Text size="xs" c="dimmed">
            Company ID
          </Text>
          <Text size="sm">{company.id}</Text>
        </div>
        <Button
          variant="light"
          onClick={() => {
            onShowMembers(company.id);
          }}
        >
          View members
        </Button>
      </Group>
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Assigned SKUs
        </Text>
        {skus.length ? (
          <ul className="company-assigned-skus" aria-label={`Assigned SKUs for ${company.name}`}>
            {skus.map((sku) => (
              <li key={sku}>
                <SkuTransactionLink sku={sku} onShowTransactions={onShowTransactions} />
              </li>
            ))}
          </ul>
        ) : (
          <Text size="sm" c="dimmed">
            No SKUs are assigned to this company.
          </Text>
        )}
      </Stack>
      <DeleteCompanyControl company={company} onDeleted={onDeleted} />
    </Stack>
  );
}
