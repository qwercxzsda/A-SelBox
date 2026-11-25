import { Alert, Stack, Text } from "@mantine/core";
import { AlertTable } from "./AlertTable";
import type { SkuConfigurationRequirement } from "./api/sku-configuration-types";
import type { SkuFormIssue } from "./sku-configuration-form";
import { FEE_PERIOD_FROM, FEE_PERIOD_UNTIL } from "./fee-period-labels";

function byMarketplaceAndDate(
  left: SkuConfigurationRequirement,
  right: SkuConfigurationRequirement,
) {
  return (
    left.marketplace_name.localeCompare(right.marketplace_name) ||
    left.valid_from.localeCompare(right.valid_from)
  );
}

const date = (value: string) => <time dateTime={value}>{value}</time>;

const GAP_COLUMNS = [
  {
    key: "marketplace",
    label: "Marketplace",
    value: (gap: SkuConfigurationRequirement) => gap.marketplace_name,
  },
  {
    key: "from",
    label: FEE_PERIOD_FROM,
    value: (gap: SkuConfigurationRequirement) => date(gap.valid_from),
  },
  {
    key: "until",
    label: FEE_PERIOD_UNTIL,
    value: (gap: SkuConfigurationRequirement) => date(gap.valid_to),
  },
] as const;

/** One SKU's setup problems: short lines, then each missing fee rate as an aligned table row. */
export function SkuConfigurationIssues({
  sku,
  issues,
}: {
  sku: string;
  issues: readonly SkuFormIssue[];
}) {
  const gaps = issues.flatMap((issue) => (issue.gap ? [issue.gap] : [])).sort(byMarketplaceAndDate);
  const messages = [...new Set(issues.filter((issue) => !issue.gap).map(({ message }) => message))];
  if (gaps.length === 0 && messages.length === 0) return null;
  return (
    <Alert color="orange" title="Needs setup">
      <Stack gap="xs">
        {messages.map((message) => (
          <Text key={message} size="sm">
            {message}
          </Text>
        ))}
        {gaps.length ? (
          <>
            <Text size="sm">Missing fee rates</Text>
            <AlertTable
              label={`Missing fee rates for ${sku}`}
              columns={GAP_COLUMNS}
              rows={gaps}
              rowKey={(gap) => `${gap.marketplace_name}:${gap.valid_from}`}
            />
          </>
        ) : null}
      </Stack>
    </Alert>
  );
}
