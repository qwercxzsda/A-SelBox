import { Stack, Text } from "@mantine/core";
import type { Company } from "./api";
import { DeleteCompanyControl } from "./DeleteCompanyControl";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { DetailSection } from "./DetailSection";
import { AdditionalDetails } from "./AdditionalDetails";
import { formatRecordDate } from "./date-display";

export function CompanyDetails({
  company,
  skus,
  onDeleted,
  onShowTransactions,
}: {
  company: Company;
  skus: string[];
  onDeleted: (company: Company, deleted: boolean) => void;
  onShowTransactions: (sku: string) => void;
}) {
  return (
    <Stack
      component="section"
      aria-label={`Company details for ${company.name}`}
      gap={0}
      className="company-details"
    >
      <DetailSection
        title="Assigned SKUs"
        actions={
          <Text size="sm" c="dimmed">
            {skus.length.toLocaleString("en-US")}
          </Text>
        }
      >
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
            No assigned SKUs
          </Text>
        )}
      </DetailSection>
      <DetailSection title="Manage company">
        <DeleteCompanyControl company={company} onDeleted={onDeleted} />
      </DetailSection>
      <AdditionalDetails
        stateKey={`company:${company.id}:metadata`}
        label="Additional company details"
        rows={[
          { field: "Company ID", value: company.id },
          {
            field: "Created (UTC)",
            value: company.created_at
              ? formatRecordDate(company.created_at, { includeTimeZone: false })
              : null,
          },
        ]}
      />
    </Stack>
  );
}
