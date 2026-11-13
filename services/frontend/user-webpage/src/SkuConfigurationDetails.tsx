import { useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { SkuConfigurationMetadata } from "./SkuConfigurationMetadata";

export function SkuConfigurationDetails({
  item,
  savedItem,
  companyName,
  issues,
  administrator,
  isSaving,
  hasDraft,
  hasUnfinishedEdit,
  onEdit,
  onDiscardDraft,
  onShowTransactions,
  schedules,
}: {
  item: SkuConfigurationItem;
  savedItem: SkuConfigurationItem | null;
  companyName: string;
  issues: readonly SkuFormIssue[];
  administrator: boolean;
  isSaving: boolean;
  hasDraft: boolean;
  hasUnfinishedEdit: boolean;
  onEdit: () => void;
  onDiscardDraft: () => void;
  onShowTransactions: (sku: string) => void;
  schedules: ReactNode;
}) {
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      document.activeElement === document.body ||
      document.activeElement === document.documentElement
    )
      editButton.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="fee-details fee-panel-enter">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div className="fee-details-identity">
            <Title order={3} size="h4">
              <SkuTransactionLink sku={item.sku} onShowTransactions={onShowTransactions} />
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              {companyName}
            </Text>
            {hasUnfinishedEdit ? (
              <Text size="sm" c="dimmed" mt={4}>
                Unfinished edit saved
              </Text>
            ) : null}
          </div>
          {administrator ? (
            <Button
              ref={editButton}
              aria-label={`Edit ${item.sku}`}
              disabled={isSaving}
              onClick={onEdit}
            >
              Edit
            </Button>
          ) : null}
        </Group>
        {hasDraft ? (
          <Alert color="cyan">
            <Group justify="space-between" gap="sm">
              <Text size="sm">Showing your draft. Review changes to publish it.</Text>
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                aria-label={`Discard draft for ${item.sku}`}
                disabled={isSaving}
                onClick={() => {
                  editButton.current?.focus();
                  onDiscardDraft();
                }}
              >
                Discard draft
              </Button>
            </Group>
          </Alert>
        ) : null}
        {issues.length ? (
          <Alert color="orange" title="Needs setup">
            <Stack gap={4}>
              {issues.map((issue, index) => (
                <Text key={index} size="sm">
                  {issue.message}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
      {schedules}
      {administrator ? <SkuConfigurationMetadata item={savedItem} /> : null}
    </div>
  );
}
