import { useEffect, type ReactNode, type RefObject } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import type { SkuFormIssue } from "./sku-configuration-form";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { SkuConfigurationMetadata } from "./SkuConfigurationMetadata";
import { SkuConfigurationIssues } from "./SkuConfigurationIssues";
import { DetailFields } from "./DetailFields";
import { StatusBadge } from "./StatusBadge";
import { FEE_STATUS_LABELS, FEE_STATUS_TONES } from "./fee-status";

export function SkuConfigurationDetails({
  item,
  savedItem,
  companyName,
  issues,
  administrator,
  editButtonRef,
  isSaving,
  hasDraft,
  hasUnfinishedEdit,
  onDiscardDraft,
  onShowTransactions,
  schedules,
}: {
  item: SkuConfigurationItem;
  savedItem: SkuConfigurationItem | null;
  companyName: string;
  issues: readonly SkuFormIssue[];
  administrator: boolean;
  /** Edit sits in the drawer header; focus continues there when this content replaces the editor. */
  editButtonRef: RefObject<HTMLButtonElement | null>;
  isSaving: boolean;
  hasDraft: boolean;
  hasUnfinishedEdit: boolean;
  onDiscardDraft: () => void;
  onShowTransactions: (sku: string) => void;
  schedules: ReactNode;
}) {
  useEffect(() => {
    if (
      document.activeElement === document.body ||
      document.activeElement === document.documentElement
    )
      editButtonRef.current?.focus({ preventScroll: true });
  }, [editButtonRef]);
  return (
    <div className="editing-drawer-details drawer-panel-enter">
      <Stack gap="lg">
        {hasUnfinishedEdit ? (
          <div>
            <StatusBadge tone={FEE_STATUS_TONES.unfinished}>
              {FEE_STATUS_LABELS.unfinished}
            </StatusBadge>
          </div>
        ) : null}
        <DetailFields
          fields={[
            {
              key: "sku",
              label: "SKU",
              value: <SkuTransactionLink sku={item.sku} onShowTransactions={onShowTransactions} />,
            },
            { key: "company", label: "Company", value: companyName },
          ]}
        />
        {hasDraft ? (
          <Alert color="cyan">
            <Group justify="space-between" gap="sm">
              <Text size="sm">Showing your unsaved draft.</Text>
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                aria-label={`Discard draft for ${item.sku}`}
                disabled={isSaving}
                onClick={() => {
                  editButtonRef.current?.focus();
                  onDiscardDraft();
                }}
              >
                Discard draft
              </Button>
            </Group>
          </Alert>
        ) : null}
        <SkuConfigurationIssues sku={item.sku} issues={issues} />
      </Stack>
      {schedules}
      {administrator ? <SkuConfigurationMetadata item={savedItem} /> : null}
    </div>
  );
}
