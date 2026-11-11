import { Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { ExpandableTableRow } from "./ExpandableTable";
import { FEE_STATUS_LABELS, type FeeStatus } from "./fee-status";
import type { SkuFormIssue } from "./sku-configuration-form";
import { SkuFeePeriods } from "./SkuFeePeriods";
import { SkuTransactionLink } from "./SkuTransactionLink";

export function SkuConfigurationRow({
  item,
  companyName,
  marketplaces,
  statuses,
  issues,
  administrator,
  isSaving,
  expanded,
  columnCount,
  onToggle,
  onEdit,
  onShowTransactions,
  onDiscardDraft,
}: {
  item: SkuConfigurationItem;
  companyName: string;
  marketplaces: readonly string[];
  statuses: readonly FeeStatus[];
  issues: readonly SkuFormIssue[];
  administrator: boolean;
  isSaving: boolean;
  expanded: boolean;
  columnCount: number;
  onToggle: (sku: string) => void;
  onEdit: (sku: string) => void;
  onShowTransactions: (sku: string) => void;
  onDiscardDraft: (sku: string) => void;
}) {
  return (
    <ExpandableTableRow
      expanded={expanded}
      onToggle={() => {
        onToggle(item.sku);
      }}
      toggleLabel={`marketplace fees for ${item.sku}: Fee periods (${String(item.periods.length)})`}
      detailsLabel={`Fee periods for ${item.sku}`}
      disclosureText="fee periods"
      columnCount={columnCount}
      actions={
        administrator ? (
          <Button
            variant="light"
            size="compact-sm"
            aria-label={`Edit ${item.sku}`}
            disabled={isSaving}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onEdit(item.sku);
            }}
          >
            Edit
          </Button>
        ) : undefined
      }
      details={
        <Stack gap="sm">
          {administrator && statuses.includes("draft") ? (
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="#9e1834"
                aria-label={`Discard draft for ${item.sku}`}
                disabled={isSaving}
                onClick={() => {
                  onDiscardDraft(item.sku);
                }}
              >
                Discard draft
              </Button>
            </Group>
          ) : null}
          {issues.map((issue, index) => (
            <Text key={index} size="sm" c="orange.8">
              {issue.message}
            </Text>
          ))}
          <SkuFeePeriods item={item} />
        </Stack>
      }
    >
      <Table.Td className="fee-sku-identity">
        <SkuTransactionLink sku={item.sku} onShowTransactions={onShowTransactions} />
      </Table.Td>
      {administrator ? <Table.Td>{companyName}</Table.Td> : null}
      <Table.Td>
        <span title={marketplaces.join(", ")}>
          {marketplaces.length === 0
            ? "Not set"
            : marketplaces.length === 1
              ? marketplaces[0]
              : `${String(marketplaces.length)} marketplaces`}
        </span>
      </Table.Td>
      <Table.Td className="numeric">{item.periods.length}</Table.Td>
      <Table.Td>
        <Group gap={6}>
          {statuses.map((status) =>
            status === "saved" ? (
              <Text key={status} size="sm" c="dimmed">
                {FEE_STATUS_LABELS[status]}
              </Text>
            ) : (
              <Badge
                key={status}
                size="xs"
                variant="light"
                color={status === "draft" ? "cyan" : "orange"}
              >
                {FEE_STATUS_LABELS[status]}
              </Badge>
            ),
          )}
        </Group>
      </Table.Td>
    </ExpandableTableRow>
  );
}
